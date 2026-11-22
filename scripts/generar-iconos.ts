/**
 * Genera los íconos de la PWA (PNG, sin dependencias): `node scripts/generar-iconos.ts`.
 * Fondo de color liso con una "L" blanca dentro de la zona segura (80 % central), así sirve como ícono "maskable".
 * Los PNG resultantes están versionados en src/cliente/publico/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const FONDO = [0x1e, 0x3a, 0x5f];
const LETRA = [0xff, 0xff, 0xff];

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function trozo(tipo: string, datos: Uint8Array): Buffer {
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

export function crearPng(lado: number): Buffer {
  // La "L": trazo vertical y base, dentro del 60 % central.
  const x0 = Math.round(lado * 0.32), x1 = Math.round(lado * 0.46);
  const y0 = Math.round(lado * 0.24), y1 = Math.round(lado * 0.76);
  const xFin = Math.round(lado * 0.68), yBase = Math.round(lado * 0.62);
  const filas: Buffer[] = [];
  for (let y = 0; y < lado; y++) {
    const fila = Buffer.alloc(1 + lado * 3); // byte de filtro 0 + RGB
    for (let x = 0; x < lado; x++) {
      const enL = (x >= x0 && x < x1 && y >= y0 && y < y1) || (x >= x0 && x < xFin && y >= yBase && y < y1);
      const [r, g, b] = enL ? LETRA : FONDO;
      fila[1 + x * 3] = r as number;
      fila[2 + x * 3] = g as number;
      fila[3 + x * 3] = b as number;
    }
    filas.push(fila);
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(lado, 0);
  cabecera.writeUInt32BE(lado, 4);
  cabecera[8] = 8; // 8 bits
  cabecera[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", cabecera),
    trozo("IDAT", deflateSync(Buffer.concat(filas), { level: 9 })),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1]?.endsWith("generar-iconos.ts")) {
  mkdirSync("src/cliente/publico", { recursive: true });
  for (const lado of [192, 512]) {
    writeFileSync(`src/cliente/publico/icono-${lado}.png`, crearPng(lado));
    console.log(`src/cliente/publico/icono-${lado}.png`);
  }
}
