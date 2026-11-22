/** Lógica pura del service worker: qué pedidos puede servir la caché. Se prueba sin navegador. */

/** Rutas de la API: nunca se cachean ni se sirven desde la caché. */
export const PREFIJOS_API = ["/auth", "/sync", "/export", "/health"] as const;

/** Archivos de la app que se precargan (rutas relativas al alcance del service worker). */
export const ARCHIVOS_APP = ["./", "index.html", "app.js", "estilos.css", "manifest.webmanifest", "icono-192.png", "icono-512.png"] as const;

export type Decision = "red" | "app";

/** "red": dejarlo pasar al servidor sin tocar la caché. "app": red primero y caché si no hay conexión. */
export function decidir(metodo: string, url: string, origen: string): Decision {
  if (metodo.toUpperCase() !== "GET") return "red";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "red";
  }
  if (u.origin !== origen) return "red";
  const ruta = u.pathname.replace(/\/{2,}/g, "/");
  for (const p of PREFIJOS_API) {
    if (ruta === p || ruta.startsWith(`${p}/`)) return "red";
  }
  if (ruta === "/sw.js") return "red";
  return "app";
}

export function nombreDeCache(version: string): string {
  return `lean-os-${version}`;
}

/** Cachés viejas a borrar: las de Lean OS que no son la actual. */
export function cachesObsoletas(nombres: readonly string[], version: string): string[] {
  const actual = nombreDeCache(version);
  return nombres.filter((n) => n.startsWith("lean-os-") && n !== actual);
}
