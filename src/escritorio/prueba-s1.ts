/**
 * Código que el modo de prueba del .exe ejecuta DENTRO de la página para S1 (IndexedDB directa, sin eval anidado).
 * Cada función devuelve el texto de una expresión async que resuelve a "OK" o lanza un error.
 * Usa la base y las stores de src/cliente/almacen-indexeddb.ts ("lean-os", store "tarjetas").
 */
export const ID_TARJETA_PRUEBA = "prueba-s1-tarjeta-0001";
export const PREGUNTA_PRUEBA = "¿Sobrevive la tarjeta al cerrar el .exe?";

const COMUN = `
const abrir = async () => {
  for (let i = 0; i < 100; i++) {
    const db = await new Promise((ok, mal) => { const r = indexedDB.open("lean-os"); r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });
    if (db.objectStoreNames.contains("tarjetas")) return db;
    db.close();
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error("la base lean-os no tiene la store tarjetas");
};
`;

export function codigoEscribir(): string {
  const tarjeta = {
    id: ID_TARJETA_PRUEBA, created_at: "2026-11-22T15:00:00.000Z", updated_at: "2026-11-22T15:00:00.000Z", deleted_at: null, rev: null,
    area_id: "prueba-s1-area", pregunta: PREGUNTA_PRUEBA, respuesta: "Sí.", pista: null, suspendida: false, importacion_id: null,
    ease: 2.5, intervalo: 3, reps: 2, lapses: 0, vence: "2026-11-25",
    contenido_updated_at: "2026-11-22T15:00:00.000Z", repaso_updated_at: "2026-11-22T15:00:00.000Z",
  };
  return `(async () => { ${COMUN}
  const db = await abrir();
  await new Promise((ok, mal) => {
    const tx = db.transaction("tarjetas", "readwrite");
    tx.objectStore("tarjetas").put(${JSON.stringify(tarjeta)});
    tx.oncomplete = () => ok(); tx.onerror = () => mal(tx.error); tx.onabort = () => mal(tx.error);
  });
  db.close();
  return "OK";
})()`;
}

export function codigoLeer(): string {
  return `(async () => { ${COMUN}
  const db = await abrir();
  const t = await new Promise((ok, mal) => { const r = db.transaction("tarjetas").objectStore("tarjetas").get(${JSON.stringify(ID_TARJETA_PRUEBA)}); r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });
  db.close();
  if (!t || t.pregunta !== ${JSON.stringify(PREGUNTA_PRUEBA)} || t.reps !== 2 || t.intervalo !== 3) throw new Error("la tarjeta de prueba no está");
  return "OK";
})()`;
}
