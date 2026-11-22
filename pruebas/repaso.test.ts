import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { diaLogico } from "../src/compartido/dia.ts";
import type { Calificacion, Tarjeta } from "../src/compartido/esquema.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { SesionRepaso, calificarYGuardar, construirCola, deshacerCalificacion, sumarDias } from "../src/compartido/repaso.ts";

// 22/11/2026 12:00 en Buenos Aires (UTC-3)
const INICIO = "2026-11-22T15:00:00.000Z";
let n = 0;
const tarjeta = (p: Partial<Tarjeta> = {}): Tarjeta => ({
  id: `t${++n}`, created_at: `2026-11-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`, updated_at: "2026-11-01T00:00:00.000Z",
  deleted_at: null, rev: null, area_id: "a1", pregunta: `p${n}`, respuesta: "r", pista: null, suspendida: false, importacion_id: null,
  ease: 2.5, intervalo: 0, reps: 0, lapses: 0, vence: "2026-11-22",
  contenido_updated_at: "2026-11-01T00:00:00.000Z", repaso_updated_at: "2026-11-01T00:00:00.000Z", ...p,
});
const nuevo = async (t: Tarjeta = tarjeta()) => {
  const a = new AlmacenMemoria();
  await a.tarjetas.guardar(t);
  return { a, r: new RelojSimulado(INICIO), id: t.id };
};

describe("repaso", () => {
  it("R1: tarjeta nueva y Bien da intervalo 1, reps 1, ease 2,5 y vence mañana", async () => {
    const { a, r, id } = await nuevo();
    const { tarjeta: t } = await calificarYGuardar(a, r, id, "bien");
    expect(t).toMatchObject({ intervalo: 1, reps: 1, ease: 2.5, vence: "2026-11-23" });
    expect(await a.tarjetas.obtener(id)).toMatchObject({ intervalo: 1, vence: "2026-11-23" });
    expect(await a.repasos.listarPorTarjeta(id)).toHaveLength(1);
  });

  it("R2: cuatro Bien seguidos avanzando el reloj dan 1, 3, 8 y 20 días", async () => {
    const { a, r, id } = await nuevo();
    const ints: number[] = [];
    for (let i = 0; i < 4; i++) {
      const { tarjeta: t } = await calificarYGuardar(a, r, id, "bien");
      ints.push(t.intervalo);
      expect(t.vence).toBe(sumarDias(diaLogico(r), t.intervalo));
      r.avanzarDias(t.intervalo);
    }
    expect(ints).toEqual([1, 3, 8, 20]);
  });

  it("R3: tarjeta nueva y Fácil da intervalo 4 y ease 2,65", async () => {
    const { a, r, id } = await nuevo();
    const { tarjeta: t } = await calificarYGuardar(a, r, id, "facil");
    expect(t).toMatchObject({ intervalo: 4, ease: 2.65, reps: 1 });
  });

  it("R4: reps 5 y Otra vez da reps 0, lapses+1, ease -0,20 y reaparece en la misma sesión", async () => {
    const { a, r, id } = await nuevo(tarjeta({ reps: 5, intervalo: 30, ease: 2.5, vence: "2026-11-22" }));
    const s = new SesionRepaso(a, r, await construirCola(a, r));
    const { tarjeta: t } = await s.calificar("otra_vez");
    expect(t).toMatchObject({ reps: 0, lapses: 1, ease: 2.3, intervalo: 0, vence: "2026-11-22" });
    expect(s.actualId).toBe(id);
    expect(s.pendientes).toBe(1);
    // Deshacer restaura el estado y no pierde el registro (se compensa).
    expect(await s.deshacer()).toBe(true);
    expect(await a.tarjetas.obtener(id)).toMatchObject({ reps: 5, lapses: 0, ease: 2.5, intervalo: 30 });
    expect(await a.repasos.listarPorTarjeta(id)).toHaveLength(2);
  });

  it("R5: 20 Otra vez seguidos dejan el ease en 1,3", async () => {
    const { a, r, id } = await nuevo();
    let t!: Tarjeta;
    for (let i = 0; i < 20; i++) t = (await calificarYGuardar(a, r, id, "otra_vez")).tarjeta;
    expect(t.ease).toBe(1.3);
    expect(t.lapses).toBe(20);
    const d = (await calificarYGuardar(a, r, id, "dificil")).tarjeta;
    expect(d.ease).toBe(1.3);
  });

  it("R6: un cálculo de más de 365 días se guarda como 365", async () => {
    const { a, r, id } = await nuevo(tarjeta({ reps: 8, intervalo: 300, ease: 2.5 }));
    const { tarjeta: t } = await calificarYGuardar(a, r, id, "facil");
    expect(t.intervalo).toBe(365);
    expect(t.vence).toBe(sumarDias("2026-11-22", 365));
  });

  it("R7: cola con vencidas, una que vence mañana y 25 nuevas: vencidas y 20 nuevas, no la de mañana", async () => {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado(INICIO);
    const venc = [
      tarjeta({ id: "v-hoy", reps: 2, intervalo: 3, vence: "2026-11-22" }),
      tarjeta({ id: "v-vieja", reps: 2, intervalo: 3, vence: "2026-11-10" }),
      tarjeta({ id: "v-ayer", reps: 2, intervalo: 3, vence: "2026-11-21" }),
    ];
    const manana = tarjeta({ id: "manana", reps: 2, intervalo: 3, vence: "2026-11-23" });
    const susp = tarjeta({ id: "susp", reps: 2, intervalo: 3, vence: "2026-11-01", suspendida: true });
    const borr = tarjeta({ id: "borr", reps: 2, intervalo: 3, vence: "2026-11-01", deleted_at: "2026-11-20T00:00:00.000Z" });
    const nuevas = Array.from({ length: 25 }, () => tarjeta());
    await a.tarjetas.guardarVarios([...venc, manana, susp, borr, ...nuevas]);
    const cola = await construirCola(a, r);
    expect(cola).toHaveLength(23);
    expect(cola.slice(0, 3).map((t) => t.id)).toEqual(["v-vieja", "v-ayer", "v-hoy"]);
    expect(cola.slice(3).map((t) => t.id)).toEqual(nuevas.slice(0, 20).map((t) => t.id));
    expect(cola.some((t) => ["manana", "susp", "borr"].includes(t.id))).toBe(false);
  });

  it("R7: las nuevas ya repasadas hoy cuentan contra el límite diario", async () => {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado(INICIO);
    await a.tarjetas.guardarVarios(Array.from({ length: 25 }, () => tarjeta()));
    const c1 = await construirCola(a, r, { limiteNuevas: 5 });
    await calificarYGuardar(a, r, c1[0]!.id, "bien");
    await calificarYGuardar(a, r, c1[1]!.id, "otra_vez");
    const c2 = await construirCola(a, r, { limiteNuevas: 5 });
    // 2 ya repasadas hoy: quedan 3 nuevas, más la que falló (vence hoy).
    expect(c2.filter((t) => t.reps === 0 && t.lapses === 0)).toHaveLength(3);
    expect(c2.map((t) => t.id)).toContain(c1[1]!.id);
  });

  it("R8: a las 03:59 sigue el día anterior y a las 04:00 empieza el nuevo", () => {
    const r = new RelojSimulado("2026-11-23T06:59:00.000Z"); // 03:59 en Buenos Aires
    expect(diaLogico(r)).toBe("2026-11-22");
    r.avanzarMinutos(1); // 04:00
    expect(diaLogico(r)).toBe("2026-11-23");
  });

  it("R4 (corte): si se corta entre guardar el repaso y la tarjeta, la tarjeta nueva sigue en la cola", async () => {
    const { a, r, id } = await nuevo();
    const guardar = a.tarjetas.guardar.bind(a.tarjetas);
    a.tarjetas.guardar = async () => { throw new Error("corte"); };
    await expect(calificarYGuardar(a, r, id, "bien")).rejects.toThrow("corte");
    a.tarjetas.guardar = guardar;
    expect((await a.repasos.listarPorTarjeta(id))).toHaveLength(1);
    expect((await construirCola(a, r)).map((t) => t.id)).toEqual([id]);
  });

  it("sesión: saltea tarjetas borradas o suspendidas durante la sesión", async () => {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado(INICIO);
    const [t1, t2, t3] = [tarjeta(), tarjeta(), tarjeta()] as [Tarjeta, Tarjeta, Tarjeta];
    await a.tarjetas.guardarVarios([t1, t2, t3]);
    const s = new SesionRepaso(a, r, await construirCola(a, r));
    await a.tarjetas.guardar({ ...t1, deleted_at: "2026-11-22T15:00:00.000Z" });
    await a.tarjetas.guardar({ ...t2, suspendida: true });
    expect(await s.siguiente()).toBe(t3.id);
    const { tarjeta: t } = await s.calificar("bien");
    expect(t.id).toBe(t3.id);
    expect(s.pendientes).toBe(0);
  });
});
