import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { TABLAS } from "../src/compartido/esquema.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { crearApp } from "../src/servidor/app.ts";
import { abrirBase } from "../src/servidor/base.ts";
import { hashArgon2 } from "../src/servidor/config.ts";
import {
  contarTodo, exportarTodo, fechaDeRespaldo, PlanificadorDiario, proximoRespaldo, respaldarAhora, restaurarRespaldo,
} from "../src/servidor/respaldo.ts";

const CLAVE = "clave-de-prueba-123";
let hash = "";
beforeAll(async () => {
  hash = await hashArgon2(CLAVE);
});

const T0 = "2026-03-10T12:00:00.000Z";
const mas = (min: number, base = T0) => new Date(Date.parse(base) + min * 60_000).toISOString();

async function montar() {
  const reloj = new RelojSimulado(T0);
  const db = abrirBase(":memory:", reloj);
  const app = crearApp({ reloj, base: db, secretos: { passwordHash: hash, sessionSecret: "s" }, registrar: () => {} });
  const r = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: CLAVE }),
  });
  const token = ((await r.json()) as { token: string }).token;
  const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const push = async (cambios: unknown[], extra: object = {}) => {
    const res = await app.request("/sync/push", { method: "POST", headers: h, body: JSON.stringify({ cambios, ...extra }) });
    return { status: res.status, cuerpo: (await res.json()) as any };
  };
  const pull = async (query = "since=0") => {
    const res = await app.request(`/sync/pull?${query}`, { headers: h });
    return { status: res.status, cuerpo: (await res.json()) as any };
  };
  return { app, reloj, db, h, push, pull };
}

const tarjeta = (id: string, extra: Record<string, unknown> = {}) => ({
  id, created_at: T0, updated_at: T0, deleted_at: null, rev: null,
  area_id: "a1", pregunta: `p-${id}`, respuesta: "r", pista: null, suspendida: false, importacion_id: null,
  ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: "2026-03-10",
  contenido_updated_at: T0, repaso_updated_at: T0, ...extra,
});
const tarea = (id: string, extra: Record<string, unknown> = {}) => ({
  id, created_at: T0, updated_at: T0, deleted_at: null, rev: null,
  titulo: "t", fecha: null, meta_id: null, nota: null, estado: "pendiente", hecha_en: null, ...extra,
});
const c = (tabla: string, registro: unknown) => ({ tabla, registro });

/** Un servidor con un dato de cada tipo. */
async function poblar(m: Awaited<ReturnType<typeof montar>>) {
  const base = { created_at: T0, updated_at: T0, deleted_at: null, rev: null };
  await m.push([
    c("areas", { ...base, id: "a1", nombre: "Prog", nombre_normalizado: "prog", padre_id: null }),
    c("tarjetas", tarjeta("k1")),
    c("tarjetas", tarjeta("k2")),
    c("repasos", { ...base, id: "r1", tarjeta_id: "k1", calificacion: "bien", repasado_en: T0, ease_antes: 2.5, ease_despues: 2.5, intervalo_antes: 0, intervalo_despues: 1 }),
    c("metas", { ...base, id: "m1", tipo: "anual", anio: 2026, trimestre: null, titulo: "m", estado: "activa", padre_id: null }),
    c("tareas", tarea("t1")),
    c("apuntes", { ...base, id: "ap1", titulo: null, texto: "x", tipo: "idea", etiquetas: [], area_id: null, tema: null, importacion_id: null }),
    c("importaciones", { ...base, id: "i1", tema: "t", fecha_bloque: "2026-03-10", area_id: "a1", tarjetas_creadas: ["k1"], duplicadas_omitidas: 0, apunte_id: null }),
  ]);
}

describe("sync: push, pull, conflictos", () => {
  it("S3: repetir la sincronización dos veces seguidas no duplica nada", async () => {
    const m = await montar();
    const cambios = [c("tarjetas", tarjeta("k1")), c("tareas", tarea("t1")), c("repasos", { id: "r1", created_at: T0, updated_at: T0, deleted_at: null, rev: null, tarjeta_id: "k1", calificacion: "bien", repasado_en: T0, ease_antes: 2.5, ease_despues: 2.5, intervalo_antes: 0, intervalo_despues: 1 })];
    const a = await m.push(cambios);
    expect(a.status).toBe(200);
    expect(a.cuerpo.aceptados).toBe(3);
    const antes = await m.pull();
    const b = await m.push(cambios);
    expect(b.cuerpo).toEqual({ aceptados: 0, rev: a.cuerpo.rev, conflictos: [] });
    const despues = await m.pull();
    expect(despues.cuerpo).toEqual(antes.cuerpo);
    expect(despues.cuerpo.tarjetas).toHaveLength(1);
    expect(despues.cuerpo.tareas).toHaveLength(1);
    expect(despues.cuerpo.repasos).toHaveLength(1);
  });

  it("S4: la misma tarea editada desde dos clientes: gana la más reciente y la otra queda en registro_sync", async () => {
    const m = await montar();
    m.reloj.avanzarMinutos(30); // las marcas de los clientes no pueden estar en el futuro
    await m.push([c("tareas", tarea("t1"))]);
    const cliA = tarea("t1", { titulo: "desde A", updated_at: mas(10) });
    const cliB = tarea("t1", { titulo: "desde B", updated_at: mas(5) });
    expect((await m.push([c("tareas", cliA)])).cuerpo.conflictos).toEqual([]); // pisa la original sin editar: no es conflicto
    const r = await m.push([c("tareas", cliB)]); // B llega tarde y es más vieja
    expect(r.cuerpo.conflictos).toEqual([expect.objectContaining({ tabla: "tareas", id: "t1" })]);
    const t = (await m.pull()).cuerpo.tareas[0];
    expect(t.titulo).toBe("desde A");
    const perdidos = m.db.prepare("SELECT version_perdedora FROM registro_sync WHERE tabla = 'tareas'").all() as { version_perdedora: string }[];
    expect(perdidos.map((p) => JSON.parse(p.version_perdedora).titulo)).toContain("desde B");
  });

  it("tareas: gana la más reciente aunque llegue primero la vieja; empate conserva el servidor", async () => {
    const m = await montar();
    await m.push([c("tareas", tarea("t1", { titulo: "vieja", updated_at: mas(1) }))]);
    await m.push([c("tareas", tarea("t1", { titulo: "nueva", updated_at: mas(2) }))]);
    expect((await m.pull()).cuerpo.tareas[0].titulo).toBe("nueva");
    await m.push([c("tareas", tarea("t1", { titulo: "empate", updated_at: mas(2) }))]);
    expect((await m.pull()).cuerpo.tareas[0].titulo).toBe("nueva");
  });

  it("tarjetas: se fusionan por grupo (contenido de un cliente + repaso del otro)", async () => {
    const m = await montar();
    m.reloj.avanzarMinutos(30);
    await m.push([c("tarjetas", tarjeta("k1"))]);
    const contenido = tarjeta("k1", { pregunta: "editada", contenido_updated_at: mas(5), updated_at: mas(5) });
    const repaso = tarjeta("k1", { ease: 2.1, intervalo: 3, reps: 1, vence: "2026-03-13", repaso_updated_at: mas(6), updated_at: mas(6) });
    await m.push([c("tarjetas", contenido)]);
    const r = await m.push([c("tarjetas", repaso)]);
    expect(r.cuerpo.conflictos).toEqual([]);
    const k = (await m.pull()).cuerpo.tarjetas[0];
    expect(k).toMatchObject({ pregunta: "editada", ease: 2.1, intervalo: 3, vence: "2026-03-13", contenido_updated_at: mas(5), repaso_updated_at: mas(6) });
    // un repaso más viejo no pisa al más nuevo y queda registrado
    const viejo = tarjeta("k1", { ease: 1.3, repaso_updated_at: mas(1) });
    const r2 = await m.push([c("tarjetas", viejo)]);
    expect(r2.cuerpo.conflictos).toHaveLength(1);
    expect((await m.pull()).cuerpo.tarjetas[0].ease).toBe(2.1);
  });

  it("una marca con más de 5 minutos de futuro se trata como ahora; hasta 5 minutos se respeta", async () => {
    const m = await montar();
    await m.push([c("tareas", tarea("t1", { updated_at: mas(60) })), c("tareas", tarea("t2", { updated_at: mas(4) }))]);
    const { tareas } = (await m.pull()).cuerpo;
    expect(tareas.find((t: any) => t.id === "t1").updated_at).toBe(T0);
    expect(tareas.find((t: any) => t.id === "t2").updated_at).toBe(mas(4));
    // el reenvío con la marca futura sigue siendo idempotente aunque pase el tiempo
    m.reloj.avanzarMinutos(10);
    expect((await m.push([c("tareas", tarea("t1", { updated_at: mas(60) }))])).cuerpo.aceptados).toBe(0);
  });

  it("valida el cuerpo con mensajes en castellano y sin eco del contenido", async () => {
    const m = await montar();
    const secreto = "CONTENIDO-PRIVADO";
    const casos: unknown[] = [
      {}, { cambios: "x" }, { cambios: [c("inventada", tarea("t"))] }, { cambios: [c("tareas", { id: 5, updated_at: T0 })] },
      { cambios: [c("tareas", { id: secreto })] }, { cambios: [c("tarjetas", tarea(secreto))] },
      { cambios: [], confirmar_borrado_masivo: "si" },
    ];
    for (const cuerpo of casos) {
      const res = await m.app.request("/sync/push", { method: "POST", headers: m.h, body: JSON.stringify(cuerpo) });
      const texto = await res.text();
      expect(res.status).toBe(400);
      expect(texto).not.toContain(secreto);
      expect(JSON.parse(texto).error).toMatch(/[a-z]/);
    }
    const mal = await m.app.request("/sync/push", { method: "POST", headers: m.h, body: "{no" });
    expect(mal.status).toBe(400);
    expect((await m.pull("since=-1")).status).toBe(400);
    expect((await m.pull("since=abc")).status).toBe(400);
  });

  it("límites de tamaño: login 1 KB, push 10 MB", async () => {
    const m = await montar();
    const login = await m.app.request("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x".repeat(3000) }) });
    expect(login.status).toBe(413);
    const grande = JSON.stringify({ cambios: [], relleno: "x".repeat(11 * 1024 * 1024) });
    const push = await m.app.request("/sync/push", { method: "POST", headers: m.h, body: grande });
    expect(push.status).toBe(413);
  });

  it("pull: rev por cambio, incluye borrados, y pagina con hay_mas", async () => {
    const m = await montar();
    await m.push([c("tareas", tarea("t1")), c("tareas", tarea("t2", { deleted_at: T0 })), c("tarjetas", tarjeta("k1")), c("tareas", tarea("t3"))]);
    const todo = (await m.pull()).cuerpo;
    expect(todo.rev).toBe(4);
    expect(todo.hay_mas).toBe(false);
    expect(todo.tareas.map((t: any) => t.rev)).toEqual([1, 2, 4]);
    expect(todo.tareas[1].deleted_at).toBe(T0);
    const vistos: string[] = [];
    let since = 0;
    for (let i = 0; i < 10; i++) {
      const p = (await m.pull(`since=${since}&limite=3`)).cuerpo;
      for (const t of TABLAS) for (const r of p[t]) vistos.push(r.id);
      since = p.rev;
      if (!p.hay_mas) break;
    }
    expect(vistos.sort()).toEqual(["k1", "t1", "t2", "t3"]);
    expect((await m.pull("since=4")).cuerpo.tareas).toEqual([]);
  });

  it("S5: servidor vacío y cliente con datos: el pull vacío no ordena borrar y el push lo sube todo", async () => {
    const m = await montar();
    const vacio = (await m.pull("since=0")).cuerpo;
    expect(vacio).toEqual({ rev: 0, hay_mas: false, tarjetas: [], repasos: [], areas: [], metas: [], tareas: [], apuntes: [], importaciones: [] });
    // un cliente que ya vio rev 50 y encuentra un servidor vacío recibe la verdad: rev 0, sin registros
    expect((await m.pull("since=50")).cuerpo.rev).toBe(0);
    // el cliente (con sus datos locales intactos) lo sube todo
    const local = [c("tarjetas", tarjeta("k1")), c("tarjetas", tarjeta("k2")), c("tareas", tarea("t1"))];
    const r = await m.push(local);
    expect(r.cuerpo.aceptados).toBe(3);
    const despues = (await m.pull()).cuerpo;
    expect(despues.tarjetas).toHaveLength(2);
    expect(despues.tareas).toHaveLength(1);
  });

  it("S6: un push que borra más del 20 % de las tarjetas se rechaza con pedido de confirmación y no cambia nada", async () => {
    const m = await montar();
    const ids = Array.from({ length: 10 }, (_, i) => `k${i}`);
    await m.push(ids.map((id) => c("tarjetas", tarjeta(id))));
    const antes = (await m.pull()).cuerpo;
    const borrar = (n: number) => ids.slice(0, n).map((id) => c("tarjetas", tarjeta(id, { deleted_at: mas(1), contenido_updated_at: mas(1), updated_at: mas(1) })));
    const extra = c("tareas", tarea("t-nueva"));
    const r = await m.push([extra, ...borrar(3)]);
    expect(r.status).toBe(409);
    expect(r.cuerpo).toMatchObject({ requiere_confirmacion: true, tarjetas_vivas: 10, tarjetas_a_borrar: 3 });
    expect((await m.pull()).cuerpo).toEqual(antes); // ni lo borrado ni lo demás se aplicó
    expect(m.db.prepare("SELECT COUNT(*) AS n FROM registro_sync").get()).toEqual({ n: 0 });
    // exactamente 20 % pasa; con confirmación explícita se aplica
    expect((await m.push(borrar(2))).status).toBe(200);
    const conf = await m.push(borrar(3), { confirmar_borrado_masivo: true });
    expect(conf.status).toBe(200);
    expect((await m.pull()).cuerpo.tarjetas.filter((k: any) => k.deleted_at).length).toBe(3);
  });

  it("S6: con pocas tarjetas el porcentaje cuenta igual (1 de 3 se rechaza)", async () => {
    const m = await montar();
    await m.push(["a", "b", "c"].map((id) => c("tarjetas", tarjeta(id))));
    const r = await m.push([c("tarjetas", tarjeta("a", { deleted_at: mas(1), contenido_updated_at: mas(1) }))]);
    expect(r.status).toBe(409);
  });
});

describe("export, restauración y respaldos", () => {
  it("G4: respaldo y restauración en un servidor vacío con los mismos conteos de cada tipo", async () => {
    const m = await montar();
    await poblar(m);
    await m.push([c("tarjetas", tarjeta("k2", { deleted_at: mas(1), contenido_updated_at: mas(1) }))], { confirmar_borrado_masivo: true });
    const carpeta = mkdtempSync(join(tmpdir(), "resp-"));
    const ruta = respaldarAhora(m.db, carpeta, m.reloj);
    const archivo = JSON.parse(readFileSync(ruta, "utf8"));
    const otro = await montar();
    const conteos = restaurarRespaldo(otro.db, archivo);
    expect(conteos).toEqual(contarTodo(m.db));
    expect(conteos).toEqual({ tarjetas: 2, repasos: 1, areas: 1, metas: 1, tareas: 1, apuntes: 1, importaciones: 1 });
    expect((await otro.pull()).cuerpo).toEqual((await m.pull()).cuerpo);
    // el contador sigue desde donde estaba
    const r = await otro.push([c("tareas", tarea("t9"))]);
    expect(r.cuerpo.rev).toBe((await m.pull()).cuerpo.rev + 1);
  });

  it("GET /export devuelve todo (con borrados), versión de formato y fecha", async () => {
    const m = await montar();
    await m.push([c("tareas", tarea("t1")), c("tareas", tarea("t2", { deleted_at: T0 }))]);
    const res = await m.app.request("/export", { headers: m.h });
    const j = (await res.json()) as any;
    expect(j).toMatchObject({ formato: 1, exportado_en: T0, rev: 2 });
    expect(j.tablas.tareas).toHaveLength(2);
    for (const t of TABLAS) expect(Array.isArray(j.tablas[t])).toBe(true);
  });

  it("se niega a restaurar sobre datos vivos salvo reemplazo explícito; archivo inválido se rechaza", async () => {
    const m = await montar();
    await poblar(m);
    const copia = exportarTodo(m.db, m.reloj);
    const otro = await montar();
    await otro.push([c("tareas", tarea("propia"))]);
    expect(() => restaurarRespaldo(otro.db, copia)).toThrow(/ya tiene datos/);
    expect(contarTodo(otro.db).tareas).toBe(1);
    expect((await otro.pull()).cuerpo.tareas[0].id).toBe("propia");
    restaurarRespaldo(otro.db, copia, { reemplazarDatos: true });
    expect(contarTodo(otro.db)).toEqual(contarTodo(m.db));
    const vacio = await montar();
    expect(() => restaurarRespaldo(vacio.db, { formato: 99 })).toThrow(/formato/);
    expect(() => restaurarRespaldo(vacio.db, { ...copia, tablas: { ...copia.tablas, tareas: [{ id: 1 }] } })).toThrow(/inválido/);
    expect(contarTodo(vacio.db).tareas).toBe(0);
  });

  it("respaldarAhora escribe respaldo-AAAA-MM-DD.json (día de Buenos Aires) y conserva solo 30", async () => {
    const m = await montar();
    await m.push([c("tareas", tarea("t1"))]);
    const carpeta = join(mkdtempSync(join(tmpdir(), "resp-")), "respaldos");
    m.reloj.fijar("2026-03-10T02:00:00Z"); // 23:00 del 9 en Buenos Aires
    expect(respaldarAhora(m.db, carpeta, m.reloj).endsWith("respaldo-2026-03-09.json")).toBe(true);
    expect(fechaDeRespaldo(new Date("2026-03-10T06:00:00Z"))).toBe("2026-03-10");
    for (let i = 0; i < 35; i++) {
      m.reloj.fijar(new Date(Date.parse("2026-04-01T06:00:00Z") + i * 86_400_000));
      respaldarAhora(m.db, carpeta, m.reloj);
    }
    const archivos = readdirSync(carpeta).sort();
    expect(archivos).toHaveLength(30);
    expect(archivos[0]).toBe("respaldo-2026-04-06.json");
    expect(archivos.at(-1)).toBe("respaldo-2026-05-05.json");
    expect(existsSync(join(carpeta, "respaldo-2026-03-09.json"))).toBe(false);
    expect(archivos.some((f) => f.endsWith(".tmp"))).toBe(false);
    const j = JSON.parse(readFileSync(join(carpeta, archivos[0] as string), "utf8"));
    expect(j.tablas.tareas).toHaveLength(1);
  });

  it("el planificador corre una vez por día a las 03:00 de Buenos Aires con reloj inyectado", () => {
    const reloj = new RelojSimulado("2026-03-10T05:00:00Z"); // 02:00 local
    expect(proximoRespaldo(reloj.ahora()).toISOString()).toBe("2026-03-10T06:00:00.000Z");
    expect(proximoRespaldo(new Date("2026-03-10T06:00:00Z")).toISOString()).toBe("2026-03-11T06:00:00.000Z");
    const pendientes: { f: () => void; ms: number }[] = [];
    let corridas = 0;
    const fallos: unknown[] = [];
    const p = new PlanificadorDiario(reloj, () => { corridas++; if (corridas === 2) throw new Error("x"); }, (f, ms) => { pendientes.push({ f, ms }); return pendientes.length; }, () => {}, (e) => fallos.push(e));
    p.iniciar();
    expect(pendientes[0]?.ms).toBe(3_600_000);
    reloj.avanzarMs(3_600_000);
    pendientes[0]?.f();
    expect(corridas).toBe(1);
    expect(pendientes[1]?.ms).toBe(86_400_000);
    reloj.avanzarDias(1);
    pendientes[1]?.f(); // falla, pero sigue programando
    expect(fallos).toHaveLength(1);
    expect(pendientes).toHaveLength(3);
    p.detener();
    pendientes[2]?.f();
    expect(pendientes).toHaveLength(3);
  });

  it("la migración v2 crea las tablas y el registro de conflictos", async () => {
    const m = await montar();
    const nombres = (m.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((x) => x.name);
    for (const t of [...TABLAS, "registro_sync", "contador_rev"]) expect(nombres).toContain(t);
    writeFileSync(join(mkdtempSync(join(tmpdir(), "x-")), "a"), "");
  });
});
