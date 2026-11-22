/** Arranque de la app en el navegador: IndexedDB real, reloj real y localStorage. */
import { fijarHoraCambio } from "../compartido/dia.ts";
import { RelojReal } from "../compartido/reloj.ts";
import { AlmacenIndexedDB } from "./almacen-indexeddb.ts";
import { montarApp } from "./ui/app.ts";
import { cargarAjustes } from "./ui/logica.ts";

async function arrancar(): Promise<void> {
  const raiz = document.getElementById("app")!;
  try {
    const persistencia = localStorage;
    fijarHoraCambio(cargarAjustes(persistencia).horaCambio);
    const almacen = await AlmacenIndexedDB.abrir();
    montarApp(raiz, { almacen, reloj: new RelojReal(), persistencia });
  } catch {
    raiz.textContent = "No se pudo abrir la copia local de tus datos. Cerrá otras pestañas de la app y recargá la página.";
  }
}

void arrancar();
