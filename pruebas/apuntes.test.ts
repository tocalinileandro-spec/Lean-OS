import { describe, expect, it } from "vitest";
import { AlmacenMemoria } from "../src/compartido/almacen.ts";
import { RelojSimulado } from "../src/compartido/reloj.ts";
import { borrarApunte, listarPapelera, purgarPapelera, restaurarApunte } from "../src/compartido/gestion.ts";
import {
  buscarApuntes, convertirApunteATarea, convertirApunteATarjeta, crearApunte, editarApunte, tituloApunte,
} from "../src/compartido/apuntes.ts";

const nuevo = () => ({ a: new AlmacenMemoria(), r: new RelojSimulado("2026-11-22T15:00:00.000Z") });
const LARGO = "Idea para la app: mostrar el progreso de cada meta en la pantalla de Hoy con una barrita simple y clara";

describe("apuntes", () => {
  it("A1: la captura rápida con solo texto crea el apunte con título de los primeros 60 caracteres", async () => {
    const { a, r } = nuevo();
    const ap = await crearApunte(a, r, { texto: LARGO });
    expect(ap).toMatchObject({ tipo: "apunte", etiquetas: [], area_id: null, titulo: null, deleted_at: null });
    expect(tituloApunte(ap)).toBe(LARGO.slice(0, 60));
    expect(tituloApunte(ap)).toHaveLength(60);
    expect((await a.apuntes.listar()).map((x) => x.id)).toEqual([ap.id]);
    await expect(crearApunte(a, r, { texto: "   " })).rejects.toThrow();
  });

  it("A2: buscar una palabra del texto muestra el apunte y convertirlo crea la tarea con su texto", async () => {
    const { a, r } = nuevo();
    await crearApunte(a, r, { texto: "Comprar yerba y azúcar" });
    const ap = await crearApunte(a, r, { texto: "Investigar la Sincronización offline de Anki" });
    const res = await buscarApuntes(a, { texto: "sincronizacion" });
    expect(res.map((x) => x.id)).toEqual([ap.id]);
    const tarea = await convertirApunteATarea(a, r, res[0]!.id);
    expect(tarea.titulo).toBe("Investigar la Sincronización offline de Anki");
    expect(await a.tareas.obtener(tarea.id)).toEqual(tarea);
    expect(await a.apuntes.obtener(ap.id)).toEqual(ap); // el apunte sigue igual
  });

  it("apunte largo a tarea: título de 60 caracteres y nota con el texto completo", async () => {
    const { a, r } = nuevo();
    const ap = await crearApunte(a, r, { texto: LARGO });
    const t = await convertirApunteATarea(a, r, ap.id);
    expect(t.titulo).toBe(LARGO.slice(0, 60));
    expect(t.nota).toBe(LARGO);
  });

  it("título propio manda sobre el derivado; el derivado sigue al texto al editar", async () => {
    const { a, r } = nuevo();
    const ap = await crearApunte(a, r, { texto: "texto", titulo: "Mi título" });
    expect(tituloApunte(ap)).toBe("Mi título");
    const e = await editarApunte(a, r, ap.id, { titulo: "" , texto: "otro texto" });
    expect(e.titulo).toBeNull();
    expect(tituloApunte(e)).toBe("otro texto");
  });

  it("búsqueda sin tildes ni mayúsculas sobre título, texto y etiquetas, con filtros", async () => {
    const { a, r } = nuevo();
    const x = await crearApunte(a, r, { texto: "Algo", titulo: "Canción", tipo: "idea", etiquetas: ["Música"] });
    r.avanzarMinutos(1);
    const y = await crearApunte(a, r, { texto: "cancion de cuna", etiquetas: ["bebé", "música"] });
    expect((await buscarApuntes(a, { texto: "CANCION" })).map((q) => q.id)).toEqual([y.id, x.id]); // más nuevo primero
    expect((await buscarApuntes(a, { texto: "musica" })).map((q) => q.id)).toEqual([y.id, x.id]);
    expect((await buscarApuntes(a, { texto: "cancion cuna" })).map((q) => q.id)).toEqual([y.id]);
    expect((await buscarApuntes(a, { tipo: "idea" })).map((q) => q.id)).toEqual([x.id]);
    expect((await buscarApuntes(a, { etiqueta: "BEBE" })).map((q) => q.id)).toEqual([y.id]);
    expect(await buscarApuntes(a, { texto: "inexistente" })).toEqual([]);
    expect(await buscarApuntes(a)).toHaveLength(2);
  });

  it("filtro por área y área inexistente rechazada", async () => {
    const { a, r } = nuevo();
    await a.areas.guardar({ id: "ar", created_at: "x", updated_at: "x", deleted_at: null, rev: null, nombre: "Vida", nombre_normalizado: "vida", padre_id: null });
    const x = await crearApunte(a, r, { texto: "uno", area_id: "ar" });
    await crearApunte(a, r, { texto: "dos" });
    expect((await buscarApuntes(a, { area_id: "ar" })).map((q) => q.id)).toEqual([x.id]);
    await expect(crearApunte(a, r, { texto: "tres", area_id: "nada" })).rejects.toThrow();
  });

  it("convertir a tarjeta devuelve el borrador con el texto precargado y no guarda nada", async () => {
    const { a, r } = nuevo();
    const ap = await crearApunte(a, r, { texto: "¿Qué es un closure? Función con su entorno." });
    const b = await convertirApunteATarjeta(a, ap.id);
    expect(b).toMatchObject({ pregunta: "¿Qué es un closure? Función con su entorno.", respuesta: ap.texto, pista: null, area_id: null });
    expect(await a.tarjetas.listar()).toHaveLength(0);
  });

  it("borrar, restaurar y purgar apuntes; los borrados no se buscan ni se convierten", async () => {
    const { a, r } = nuevo();
    const ap = await crearApunte(a, r, { texto: "borrame" });
    await borrarApunte(a, r, ap.id);
    expect(await buscarApuntes(a, { texto: "borrame" })).toEqual([]);
    await expect(convertirApunteATarea(a, r, ap.id)).rejects.toThrow();
    expect((await listarPapelera(a)).apuntes).toHaveLength(1);
    await restaurarApunte(a, r, ap.id);
    expect(await buscarApuntes(a, { texto: "borrame" })).toHaveLength(1);
    await borrarApunte(a, r, ap.id);
    r.avanzarDias(30);
    expect(await purgarPapelera(a, r)).toBe(1);
  });
});
