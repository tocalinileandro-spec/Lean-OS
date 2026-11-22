/**
 * Exportar todo / importar un respaldo en el cliente (S7). Usa el mismo formato que GET /export del servidor
 * (src/compartido/respaldo-formato.ts). Importar es solo fusión: nunca borra ni pisa un registro con otro menos
 * reciente, y es idempotente. Si el almacén recibido es el decorado, lo importado queda anotado para sincronizar.
 */
import type { Almacen, Repositorio } from "../../compartido/almacen.ts";
import { TABLAS } from "../../compartido/esquema.ts";
import type { Id, Registro, Repaso, Tabla } from "../../compartido/esquema.ts";
import type { Reloj } from "../../compartido/reloj.ts";
import { armarExportacion, validarExportacion, validarForma } from "../../compartido/respaldo-formato.ts";
import type { Exportacion, Fila } from "../../compartido/respaldo-formato.ts";
import { fusionar } from "./fusion.ts";

const repo = (almacen: Almacen, t: Exclude<Tabla, "repasos">) => almacen[t] as unknown as Repositorio<Registro>;

/** Todo lo que hay en la copia local, borrados y repasos incluidos. */
export async function exportarLocal(almacen: Almacen, reloj: Reloj): Promise<Exportacion> {
  const tablas = {} as Record<Tabla, Fila[]>;
  let rev = 0;
  for (const t of TABLAS) {
    const lista = (t === "repasos" ? await almacen.repasos.listar() : await repo(almacen, t).listar({ incluirBorrados: true })) as unknown as Fila[];
    tablas[t] = lista;
    for (const r of lista) if (typeof r["rev"] === "number" && r["rev"] > rev) rev = r["rev"];
  }
  return armarExportacion(tablas, rev, reloj.ahora());
}

export async function exportarLocalTexto(almacen: Almacen, reloj: Reloj): Promise<string> {
  return JSON.stringify(await exportarLocal(almacen, reloj));
}

export type InformeRespaldo =
  | { ok: true; total: number; nuevos: Record<Tabla, number>; actualizados: Record<Tabla, number>; sinCambios: number }
  | { ok: false; error: string };

const ceros = () => Object.fromEntries(TABLAS.map((t) => [t, 0])) as Record<Tabla, number>;

/** Valida el archivo entero antes de tocar nada; si no es válido, no cambia nada. */
export async function importarRespaldo(almacen: Almacen, texto: string): Promise<InformeRespaldo> {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return { ok: false, error: "El archivo no se puede leer: no es un JSON válido. No se cambió nada." };
  }
  const v = validarExportacion(datos, false);
  if ("error" in v) return { ok: false, error: `${v.error} No se cambió nada.` };
  const { tablas } = v.exportacion;
  for (const t of TABLAS) {
    for (let i = 0; i < tablas[t].length; i++) {
      const motivo = validarForma(t, tablas[t][i] as Fila);
      if (motivo) return { ok: false, error: `El registro ${i + 1} de ${t} es inválido: ${motivo}. No se cambió nada.` };
    }
  }

  const nuevos = ceros();
  const actualizados = ceros();
  let sinCambios = 0;
  const lote: Record<string, Fila[]> = {};
  for (const t of TABLAS) {
    if (t === "repasos") continue;
    for (const rec of tablas[t]) {
      const local = (await repo(almacen, t).obtener(rec["id"] as Id)) as unknown as Fila | undefined;
      const f = fusionar(t, local, rec, "local");
      if (!local) {
        (lote[t] ??= []).push(f.registro);
        nuevos[t]++;
      } else if (f.cambioContenido) {
        (lote[t] ??= []).push(f.registro);
        actualizados[t]++;
      } else sinCambios++;
    }
  }
  const existentes = new Set((await almacen.repasos.listar()).map((r) => r.id));
  const repasosNuevos = tablas.repasos.filter((r) => !existentes.has(r["id"] as Id));
  nuevos.repasos = repasosNuevos.length;
  sinCambios += tablas.repasos.length - repasosNuevos.length;

  if (Object.keys(lote).length > 0) await almacen.guardarLote(lote as never);
  for (const r of repasosNuevos) await almacen.repasos.agregar(r as unknown as Repaso);

  const suma = (m: Record<Tabla, number>) => TABLAS.reduce((n, t) => n + m[t], 0);
  return { ok: true, total: suma(nuevos) + suma(actualizados) + sinCambios, nuevos, actualizados, sinCambios };
}

const NOMBRES: Record<Tabla, string> = {
  tarjetas: "tarjetas", repasos: "repasos", areas: "áreas", metas: "metas", tareas: "tareas", apuntes: "apuntes", importaciones: "importaciones",
};

/** Líneas del informe en castellano. */
export function lineasDeInforme(i: InformeRespaldo): string[] {
  if (!i.ok) return [i.error];
  const suma = (m: Record<Tabla, number>) => TABLAS.reduce((n, t) => n + m[t], 0);
  const n = suma(i.nuevos);
  const a = suma(i.actualizados);
  const lineas = [`Respaldo importado: ${n} ${n === 1 ? "registro nuevo" : "registros nuevos"}, ${a} ${a === 1 ? "actualizado" : "actualizados"} y ${i.sinCambios} que ya estaban.`];
  for (const t of TABLAS) {
    if (i.nuevos[t] > 0 || i.actualizados[t] > 0) lineas.push(`${NOMBRES[t][0]!.toUpperCase()}${NOMBRES[t].slice(1)}: ${i.nuevos[t]} nuevos, ${i.actualizados[t]} actualizados.`);
  }
  if (n === 0 && a === 0) lineas.push("No había nada nuevo: tu copia ya tenía todo lo del respaldo. No se borró nada.");
  else lineas.push("No se borró nada de lo que ya tenías. Los cambios se suben solos si tenés sesión iniciada.");
  return lineas;
}
