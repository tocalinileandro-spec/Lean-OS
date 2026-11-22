/** Arranque de la app en el navegador: IndexedDB real, reloj real, localStorage y sincronización con el servidor del mismo origen. */
import { fijarHoraCambio } from "../compartido/dia.ts";
import { RelojReal } from "../compartido/reloj.ts";
import { AlmacenIndexedDB } from "./almacen-indexeddb.ts";
import { AlmacenSincronizado, Candado } from "./sync/cola.ts";
import { MotorSync } from "./sync/motor.ts";
import { montarApp } from "./ui/app.ts";
import { cargarAjustes } from "./ui/logica.ts";

async function arrancar(): Promise<void> {
  const raiz = document.getElementById("app")!;
  try {
    const persistencia = localStorage;
    fijarHoraCambio(cargarAjustes(persistencia).horaCambio);
    const crudo = await AlmacenIndexedDB.abrir();
    const cola = crudo.cola;
    const reloj = new RelojReal();
    let motor: MotorSync | undefined;
    // La app guarda siempre en la copia local y anota cada cambio en la cola; el motor escribe en el almacén sin decorar.
    const candado = new Candado();
    const almacen = new AlmacenSincronizado(crudo, cola, {
      candado,
      alCambiar: () => motor?.cambioLocal(),
      alFallarCola: () => motor?.pedirSubidaCompleta(),
    });
    motor = new MotorSync({ almacen: crudo, cola, fetch: (url, init) => fetch(url, init), reloj, persistencia, eventos: window, candado });
    montarApp(raiz, { almacen, reloj, persistencia, sync: motor });
    motor.iniciar();
  } catch {
    raiz.textContent = "No se pudo abrir la copia local de tus datos. Cerrá otras pestañas de la app y recargá la página.";
  }
}

void arrancar();
