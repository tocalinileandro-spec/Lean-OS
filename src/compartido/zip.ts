/**
 * Lector ZIP mínimo, sin dependencias. Soporta métodos 0 (guardado) y 8 (deflate, con
 * DecompressionStream "deflate-raw": existe en los navegadores y en Node 22).
 * Rechaza ZIP64, cifrados y archivos dañados con un mensaje en castellano.
 */

export class ErrorZip extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorZip";
  }
}

export interface EntradaZip {
  nombre: string;
  bytes: Uint8Array;
}

export interface LimitesZip {
  /** Máximo de archivos dentro del ZIP (todos, estén o no seleccionados). */
  maxArchivos: number;
  /** Máximo de bytes descomprimidos entre todos los archivos leídos (anti bomba de descompresión). */
  maxBytes: number;
}

export const LIMITES_ZIP: LimitesZip = { maxArchivos: 2000, maxBytes: 50 * 1024 * 1024 };

const DANADO = "El archivo ZIP está dañado o incompleto.";

let tabla: Uint32Array | null = null;
export function crc32(datos: Uint8Array): number {
  if (!tabla) {
    tabla = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabla[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = tabla[(c ^ datos[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ¿Los bytes empiezan como un ZIP (o es un ZIP vacío)? */
export function pareceZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));
}

/** Ruta segura: sin "..", sin ruta absoluta ni letra de unidad. Devuelve la ruta con "/" o null. */
export function rutaSegura(nombre: string): string | null {
  const ruta = nombre.replace(/\\/g, "/");
  if (ruta.startsWith("/") || /^[A-Za-z]:/.test(ruta)) return null;
  const partes = ruta.split("/").filter((p) => p !== "" && p !== ".");
  if (partes.length === 0 || partes.includes("..")) return null;
  return partes.join("/");
}

async function inflar(datos: Uint8Array, maximo: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new ErrorZip("Este navegador no sabe descomprimir archivos ZIP.");
  const flujo = new DecompressionStream("deflate-raw");
  const escritor = flujo.writable.getWriter();
  // La escritura corre en paralelo a la lectura (si no, se traba con datos grandes).
  void escritor.write(datos as unknown as Uint8Array<ArrayBuffer>).then(() => escritor.close()).catch(() => undefined);
  const lector = flujo.readable.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      if (total > maximo) {
        await lector.cancel().catch(() => undefined);
        throw new ErrorZip("El ZIP descomprimido es demasiado grande (puede ser una bomba de descompresión).");
      }
      trozos.push(value);
    }
  } catch (e) {
    if (e instanceof ErrorZip) throw e;
    throw new ErrorZip(DANADO);
  }
  const salida = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) {
    salida.set(t, pos);
    pos += t.length;
  }
  return salida;
}

/**
 * Lee las entradas de un ZIP. `filtro` decide (por ruta ya saneada) cuáles se descomprimen; las demás
 * se ignoran sin leerse. Las rutas con ".." se ignoran. Lanza `ErrorZip` si el ZIP no sirve.
 */
export async function leerZip(
  bytes: Uint8Array,
  filtro: (ruta: string) => boolean = () => true,
  limites: LimitesZip = LIMITES_ZIP,
): Promise<EntradaZip[]> {
  const n = bytes.length;
  if (n < 22) throw new ErrorZip(DANADO);
  const vista = new DataView(bytes.buffer, bytes.byteOffset, n);
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
    if (vista.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ErrorZip(DANADO);
  const total = vista.getUint16(eocd + 10, true);
  const tamCentral = vista.getUint32(eocd + 12, true);
  const inicioCentral = vista.getUint32(eocd + 16, true);
  if (total === 0xffff || tamCentral === 0xffffffff || inicioCentral === 0xffffffff) {
    throw new ErrorZip("Este ZIP usa el formato ZIP64, que no se puede leer. Volvé a exportar el respaldo.");
  }
  if (total > limites.maxArchivos) throw new ErrorZip(`El ZIP tiene demasiados archivos (el máximo es ${limites.maxArchivos}).`);
  if (inicioCentral + tamCentral > eocd) throw new ErrorZip(DANADO);

  const decodificador = new TextDecoder("utf-8");
  const salida: EntradaZip[] = [];
  let acumulado = 0;
  let pos = inicioCentral;
  for (let k = 0; k < total; k++) {
    if (pos + 46 > n || vista.getUint32(pos, true) !== 0x02014b50) throw new ErrorZip(DANADO);
    const flags = vista.getUint16(pos + 8, true);
    const metodo = vista.getUint16(pos + 10, true);
    const crc = vista.getUint32(pos + 16, true);
    const tamComprimido = vista.getUint32(pos + 20, true);
    const tamReal = vista.getUint32(pos + 24, true);
    const largoNombre = vista.getUint16(pos + 28, true);
    const largoExtra = vista.getUint16(pos + 30, true);
    const largoComentario = vista.getUint16(pos + 32, true);
    const inicioLocal = vista.getUint32(pos + 42, true);
    if (pos + 46 + largoNombre > n) throw new ErrorZip(DANADO);
    const nombreCrudo = decodificador.decode(bytes.subarray(pos + 46, pos + 46 + largoNombre));
    pos += 46 + largoNombre + largoExtra + largoComentario;

    if (nombreCrudo.endsWith("/")) continue; // carpeta
    const ruta = rutaSegura(nombreCrudo);
    if (ruta === null || !filtro(ruta)) continue;

    if (flags & 1) throw new ErrorZip("El ZIP está cifrado (con contraseña); no se puede leer.");
    if (tamComprimido === 0xffffffff || tamReal === 0xffffffff || inicioLocal === 0xffffffff) {
      throw new ErrorZip("Este ZIP usa el formato ZIP64, que no se puede leer. Volvé a exportar el respaldo.");
    }
    if (metodo !== 0 && metodo !== 8) throw new ErrorZip(`El ZIP usa un método de compresión que no se puede leer (${metodo}).`);
    acumulado += tamReal;
    if (acumulado > limites.maxBytes) throw new ErrorZip("El ZIP descomprimido es demasiado grande (puede ser una bomba de descompresión).");

    if (inicioLocal + 30 > n || vista.getUint32(inicioLocal, true) !== 0x04034b50) throw new ErrorZip(DANADO);
    const inicioDatos = inicioLocal + 30 + vista.getUint16(inicioLocal + 26, true) + vista.getUint16(inicioLocal + 28, true);
    if (inicioDatos + tamComprimido > n) throw new ErrorZip(DANADO);
    const crudo = bytes.subarray(inicioDatos, inicioDatos + tamComprimido);
    const datos = metodo === 0 ? crudo.slice() : await inflar(crudo, Math.min(tamReal, limites.maxBytes) + 1);
    if (datos.length !== tamReal || crc32(datos) !== crc) throw new ErrorZip(DANADO);
    salida.push({ nombre: ruta, bytes: datos });
  }
  return salida;
}
