/**
 * Tareas recurrentes (opcional, sección 2 de la visión): lógica pura de fechas y de ids de ocurrencia.
 * Las fechas son AAAA-MM-DD y se calculan en calendario puro (UTC), sin depender de la zona horaria.
 */
import type { FechaISO, Id } from "./esquema.ts";

export type Repeticion =
  | { tipo: "diaria" }
  | { tipo: "semanal"; dias: number[] }
  | { tipo: "mensual"; dia_mes: number };

const entero = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/** Valida estrictamente una regla y la devuelve normalizada (sin campos de más). Lanza con mensaje en castellano. */
export function validarRepeticion(r: unknown): Repeticion {
  if (typeof r !== "object" || r === null || Array.isArray(r)) throw new Error("La regla de repetición no es válida");
  const o = r as Record<string, unknown>;
  if (o["tipo"] === "diaria") return { tipo: "diaria" };
  if (o["tipo"] === "semanal") {
    const dias = o["dias"];
    if (!Array.isArray(dias) || dias.length === 0) throw new Error("Elegí al menos un día de la semana");
    if (!dias.every((d) => entero(d, 1, 7))) throw new Error("Los días de la semana van del 1 (lunes) al 7 (domingo)");
    for (let i = 1; i < dias.length; i++) {
      if ((dias[i] as number) === (dias[i - 1] as number)) throw new Error("Hay días de la semana repetidos");
      if ((dias[i] as number) < (dias[i - 1] as number)) throw new Error("Los días de la semana tienen que estar ordenados");
    }
    return { tipo: "semanal", dias: [...(dias as number[])] };
  }
  if (o["tipo"] === "mensual") {
    if (!entero(o["dia_mes"], 1, 31)) throw new Error("El día del mes tiene que estar entre 1 y 31");
    return { tipo: "mensual", dia_mes: o["dia_mes"] };
  }
  throw new Error("El tipo de repetición no es válido");
}

const NOMBRE_DIA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** Texto para mostrar, en español rioplatense. */
export function describirRepeticion(r: Repeticion): string {
  if (r.tipo === "diaria") return "Se repite todos los días";
  if (r.tipo === "semanal") {
    const n = r.dias.map((d) => NOMBRE_DIA[d - 1]!);
    return `Se repite ${n.length === 1 ? `los ${n[0]}` : `los ${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`}`;
  }
  return `Se repite el día ${r.dia_mes} de cada mes`;
}

function aMs(f: FechaISO): number {
  const [a, m, d] = f.split("-").map(Number) as [number, number, number];
  return Date.UTC(a, m - 1, d);
}
function deMs(ms: number): FechaISO {
  return new Date(ms).toISOString().slice(0, 10);
}
const DIA_MS = 86_400_000;
const diasDelMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();

function cumple(r: Repeticion, f: FechaISO): boolean {
  if (r.tipo === "diaria") return true;
  const d = new Date(aMs(f));
  if (r.tipo === "semanal") return r.dias.includes(d.getUTCDay() === 0 ? 7 : d.getUTCDay());
  return d.getUTCDate() === Math.min(r.dia_mes, diasDelMes(d.getUTCFullYear(), d.getUTCMonth() + 1));
}

/** Primera fecha que cumple la regla, estrictamente posterior a max(fechaTarea, hoy). Sin fecha en la tarea, la base es hoy. */
export function proximaFecha(regla: Repeticion, fechaTarea: FechaISO | null | undefined, hoy: FechaISO): FechaISO {
  const base = fechaTarea && fechaTarea > hoy ? fechaTarea : hoy;
  let ms = aMs(base);
  for (let i = 0; i < 400; i++) {
    ms += DIA_MS;
    const f = deMs(ms);
    if (cumple(regla, f)) return f;
  }
  throw new Error("No se pudo calcular la próxima fecha");
}

/** SHA-1 sincrónico y puro (sirve igual en el navegador y en Node). */
function sha1(bytes: Uint8Array): Uint8Array {
  const rol = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const largo = bytes.length;
  const total = (((largo + 8) >> 6) + 1) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[largo] = 0x80;
  const v = new DataView(m.buffer);
  v.setUint32(total - 8, Math.floor((largo * 8) / 2 ** 32));
  v.setUint32(total - 4, (largo * 8) >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = v.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rol(a, 5) + (f >>> 0) + e + k + w[i]!) >>> 0;
      e = d; d = c; c = rol(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((x, i) => ov.setUint32(i * 4, x));
  return out;
}

/** UUID determinista (estilo v5, SHA-1) derivado de la serie y la fecha: dos dispositivos obtienen el mismo id. */
export function idOcurrencia(serieId: Id, fecha: FechaISO): Id {
  const h = sha1(new TextEncoder().encode(`lean-os:ocurrencia:${serieId}:${fecha}`)).slice(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
