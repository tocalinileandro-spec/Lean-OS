import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { borrarApunte, borrarTarjeta, crearTarjeta } from "../src/compartido/gestion.ts";
import { calificarYGuardar } from "../src/compartido/repaso.ts";
import { crearApunte } from "../src/compartido/apuntes.ts";
import { borrarMeta, borrarTarea, crearMetaAnual, crearTarea } from "../src/compartido/tareas.ts";
import { crearPurgaDiaria } from "../src/cliente/purga.ts";

async function sembrar(a: AlmacenMemoria, r: RelojSimulado, sufijo: string) {
  const t = await crearTarjeta(a, r, { pregunta: `P${sufijo}`, respuesta: "R", area_texto: "Área" });
  const ap = await crearApunte(a, r, { texto: `apunte ${sufijo}` });
  const ta = await crearTarea(a, r, { titulo: `tarea ${sufijo}` });
  const m = await crearMetaAnual(a, r, { anio: 2026, titulo: `meta ${sufijo}` });
  await borrarTarjeta(a, r, t.id);
  await borrarApunte(a, r, ap.id);
  await borrarTarea(a, r, ta.id);
  await borrarMeta(a, r, m.id);
  return [t.id, ap.id, ta.id, m.id];
}
const todos = async (a: AlmacenMemoria) => [
  ...(await a.tarjetas.listar({ incluirBorrados: true })),
  ...(await a.apuntes.listar({ incluirBorrados: true })),
  ...(await a.tareas.listar({ incluirBorrados: true })),
  ...(await a.metas.listar({ incluirBorrados: true })),
].map((x) => x.id);

describe("purga al abrir la app (local, 30 días)", () => {
  it("elimina lo de 30+ días, conserva lo de 29 días, lo no borrado y los repasos", async () => {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado("2026-10-01T15:00:00.000Z");
    const viva = await crearTarjeta(a, r, { pregunta: "viva", respuesta: "R", area_texto: "Área" });
    r.avanzarMinutos(1);
    await calificarYGuardar(a, r, viva.id, "bien");
    const vieja = await crearTarjeta(a, r, { pregunta: "vieja", respuesta: "R", area_texto: "Área" });
    r.avanzarMinutos(1);
    await calificarYGuardar(a, r, vieja.id, "bien");
    const idsViejos = [vieja.id, ...(await sembrar(a, r, "vieja"))];
    await borrarTarjeta(a, r, vieja.id);
    r.avanzarDias(1);
    const idsNuevos = await sembrar(a, r, "nueva");
    const repasosAntes = (await a.repasos.listar()).length;
    r.avanzarDias(29); // los viejos llevan 30 días; los nuevos, 29
    await crearPurgaDiaria(a, r)();
    const quedan = await todos(a);
    for (const id of idsViejos) expect(quedan).not.toContain(id);
    for (const id of [...idsNuevos, viva.id]) expect(quedan).toContain(id);
    expect((await a.repasos.listar()).length).toBe(repasosAntes);
  });

  it("corre una vez por día lógico y vuelve a correr al día siguiente", async () => {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado("2026-10-01T15:00:00.000Z");
    let llamadas = 0;
    const original = a.tarjetas.eliminarDefinitivo.bind(a.tarjetas);
    a.tarjetas.eliminarDefinitivo = async (ids) => { llamadas++; return original(ids); };
    const purgar = crearPurgaDiaria(a, r);
    await purgar();
    r.avanzarMinutos(60);
    await purgar();
    expect(llamadas).toBe(1);
    r.avanzarDias(1);
    await purgar();
    expect(llamadas).toBe(2);
  });

  it("una purga que falla no lanza ni impide abrir, y se reintenta", async () => {
    const a = new AlmacenMemoria();
    const r = new RelojSimulado("2026-10-01T15:00:00.000Z");
    const [id] = await sembrar(a, r, "x");
    r.avanzarDias(30);
    const original = a.tarjetas.eliminarDefinitivo.bind(a.tarjetas);
    a.tarjetas.eliminarDefinitivo = async () => { throw new Error("falla"); };
    await expect(crearPurgaDiaria(a, r)()).resolves.toBeUndefined();
    a.tarjetas.eliminarDefinitivo = original;
    const purgar = crearPurgaDiaria(a, r);
    await purgar();
    expect(await todos(a)).not.toContain(id);
  });
});
