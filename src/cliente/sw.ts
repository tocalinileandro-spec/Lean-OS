/** Service worker: abre la app sin conexión. Nunca toca /auth, /sync, /export, /ajustes ni /health (ver sw-logica.ts). */
import { ARCHIVOS_APP, cachesObsoletas, decidir, nombreDeCache } from "./sw-logica.ts";

declare const __VERSION__: string;
/** Tipos mínimos del contexto de service worker (el proyecto compila con la librería DOM, no con webworker). */
interface EventoExtensible {
  waitUntil(p: Promise<unknown>): void;
}
interface EventoFetch {
  request: Request;
  respondWith(r: Promise<Response>): void;
}
interface ContextoSW {
  location: Location;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(tipo: "install" | "activate", f: (e: EventoExtensible) => void): void;
  addEventListener(tipo: "fetch", f: (e: EventoFetch) => void): void;
}
const sw = self as unknown as ContextoSW;
const CACHE = nombreDeCache(__VERSION__);

sw.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...ARCHIVOS_APP])).then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ns) => Promise.all(cachesObsoletas(ns, __VERSION__).map((n) => caches.delete(n))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("fetch", (e) => {
  const pedido = e.request;
  if (decidir(pedido.method, pedido.url, sw.location.origin) === "red") return; // el navegador lo resuelve solo
  e.respondWith(
    (async () => {
      try {
        const r = await fetch(pedido);
        if (r.ok) {
          const copia = r.clone();
          void caches.open(CACHE).then((c) => c.put(pedido, copia)).catch(() => undefined);
        }
        return r;
      } catch (err) {
        const guardada = await caches.match(pedido, { ignoreSearch: true });
        if (guardada) return guardada;
        if (pedido.mode === "navigate") {
          const inicio = await caches.match("index.html");
          if (inicio) return inicio;
        }
        throw err;
      }
    })(),
  );
});
