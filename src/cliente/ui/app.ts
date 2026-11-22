/**
 * Interfaz web del módulo 1 (DOM). Dibuja lo que devuelve logica.ts y atiende eventos.
 * Recibe todo por dependencias (almacén, reloj, persistencia) y usa el documento de la raíz,
 * así se puede montar en un DOM simulado.
 */
import { deshacerUltimaImportacion, importar, type InformeImportacion } from "../../compartido/importacion/importar.ts";
import {
  borrarTarjeta, editarTarjeta, listarPapelera, moverTarjetaDeArea, reanudarTarjeta, restaurarTarjeta, suspenderTarjeta,
} from "../../compartido/gestion.ts";
import type { Calificacion, Id, Tarjeta } from "../../compartido/esquema.ts";
import {
  agruparTarjetas, cargarAjustes, formatearFecha, guardarAjustes, mensajeDeError, nombreDeArea, opcionesDeArea,
  PantallaRepaso, validarAjustes, vistaHoy, type Dependencias, type VistaRepaso,
} from "./logica.ts";

export type Pantalla = "hoy" | "repaso" | "tarjetas" | "ajustes";
const PANTALLAS: { id: Pantalla; titulo: string }[] = [
  { id: "hoy", titulo: "Hoy" }, { id: "repaso", titulo: "Repaso" }, { id: "tarjetas", titulo: "Tarjetas" }, { id: "ajustes", titulo: "Ajustes" },
];

type Hijo = Node | string | null | false | undefined;
type Props = Record<string, string | number | boolean | ((ev: Event) => void) | undefined>;

export interface AppMontada {
  ir(p: Pantalla): void;
  /** Espera a que terminen todas las acciones en curso (para pruebas). */
  esperar(): Promise<void>;
  raiz: HTMLElement;
}

export function montarApp(raiz: HTMLElement, d: Dependencias, inicial: Pantalla = "hoy"): AppMontada {
  const doc = raiz.ownerDocument;

  function h(tag: string, props: Props = {}, ...hijos: Hijo[]): HTMLElement {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === false) continue;
      if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
      else if (k === "value") (el as HTMLInputElement).value = String(v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of hijos) if (c) el.append(c);
    return el;
  }
  const boton = (texto: string, onclick: () => void, clase = "", extra: Props = {}) =>
    h("button", { type: "button", class: `boton ${clase}`.trim(), onclick: () => onclick(), ...extra }, texto);

  // ---------- estado ----------
  let pantalla: Pantalla = inicial;
  let repaso: PantallaRepaso | null = null;
  let aviso = "";
  let busqueda = "";
  let importAbierto = false;
  let textoImport = "";
  let informe: InformeImportacion | null = null;
  let papelera = false;
  let editando: Id | null = null;
  let errorAjustes = "";
  let cola: Promise<void> = Promise.resolve();

  /** Serializa las acciones: una a la vez, y siempre se redibuja al final. */
  function accion(f: () => Promise<void> | void): void {
    cola = cola.then(() => { aviso = ""; errorAjustes = ""; return f(); }).catch((e) => { aviso = mensajeDeError(e); }).then(dibujar);
  }

  function ir(p: Pantalla): void {
    accion(async () => {
      pantalla = p;
      aviso = "";
      repaso = p === "repaso" ? await PantallaRepaso.iniciar(d) : null;
    });
  }

  // ---------- estructura ----------
  const nav = h("nav", { "aria-label": "Pantallas", class: "nav" });
  const principal = h("main", { id: "principal", tabindex: "-1" });
  raiz.replaceChildren(nav, principal);

  async function dibujar(): Promise<void> {
    nav.replaceChildren(...PANTALLAS.map((p) =>
      h("button", { type: "button", class: "nav-item", "aria-current": p.id === pantalla ? "page" : undefined, onclick: () => ir(p.id) }, p.titulo)));
    const activo = doc.activeElement as HTMLElement | null;
    const idActivo = activo && activo !== doc.body ? activo.id : "";
    const contenido: Hijo[] = [];
    if (aviso) contenido.push(h("p", { class: "aviso", role: "status" }, aviso));
    try {
      if (pantalla === "hoy") contenido.push(await dibujarHoy());
      else if (pantalla === "repaso") contenido.push(await dibujarRepaso());
      else if (pantalla === "tarjetas") contenido.push(await dibujarTarjetas());
      else contenido.push(dibujarAjustes());
    } catch (e) {
      contenido.push(h("p", { class: "aviso", role: "alert" }, mensajeDeError(e)));
    }
    principal.replaceChildren(...contenido.filter((x): x is Node => !!x));
    // Si se estaba escribiendo en un campo (búsqueda), se conserva el foco; si no, va a la acción principal.
    const mismo = idActivo ? principal.querySelector<HTMLInputElement>(`#${idActivo}`) : null;
    if (mismo && mismo.id === "busqueda") {
      mismo.focus();
      mismo.setSelectionRange?.(mismo.value.length, mismo.value.length);
    } else {
      principal.querySelector<HTMLElement>("[data-foco]")?.focus?.();
    }
  }

  // ---------- Hoy ----------
  async function dibujarHoy(): Promise<Node> {
    const v = await vistaHoy(d);
    const e = v.estadisticas;
    return h("section", {},
      h("h1", {}, "Hoy"),
      h("p", { class: "suave" }, v.fecha),
      v.pendientes > 0
        ? boton(`Repasar ${v.pendientes} ${v.pendientes === 1 ? "tarjeta" : "tarjetas"}`, () => ir("repaso"), "grande principal", { "data-foco": "1" })
        : h("div", { class: "vacio" },
            h("p", {}, "No tenés tarjetas pendientes por ahora."),
            boton("Ir a Tarjetas", () => ir("tarjetas"), "suave", { "data-foco": "1" })),
      h("dl", { class: "estadisticas" },
        h("div", {}, h("dt", {}, "Pendientes hoy"), h("dd", {}, String(e.pendientesHoy))),
        h("div", {}, h("dt", {}, "Repasadas hoy"), h("dd", {}, String(e.repasadasHoy))),
        h("div", {}, h("dt", {}, "Racha"), h("dd", {}, `${e.racha} ${e.racha === 1 ? "día" : "días"}`))),
      e.porArea.length > 0 && h("div", {},
        h("h2", {}, "Tarjetas por área"),
        h("ul", { class: "lista" }, ...e.porArea.map((a) => h("li", {}, h("span", {}, a.nombre), h("strong", {}, String(a.total)))))));
  }

  // ---------- Repaso ----------
  async function dibujarRepaso(): Promise<Node> {
    if (!repaso) repaso = await PantallaRepaso.iniciar(d);
    const v: VistaRepaso = await repaso.vista();
    const deshacer = v.puedeDeshacer && boton("Deshacer (Ctrl+Z)", () => accion(() => repaso!.deshacer()), "suave chico");
    if (!v.hayTarjeta) {
      return h("section", { class: "vacio" },
        h("h1", {}, "Repaso"),
        h("p", {}, v.calificadas > 0 ? `Listo: repasaste ${v.calificadas} ${v.calificadas === 1 ? "tarjeta" : "tarjetas"}.` : "No hay tarjetas para repasar ahora."),
        boton("Volver a Hoy", () => ir("hoy"), "principal grande", { "data-foco": "1" }),
        deshacer);
    }
    const pista = v.hayPista && (v.pista !== undefined
      ? h("p", { class: "pista" }, v.pista)
      : boton("Ver pista", () => accion(() => repaso!.verPista()), "suave chico"));
    const zonaRespuesta = v.respuestaVisible
      ? h("div", {},
          h("div", { class: "respuesta", tabindex: "-1", "data-foco": "1" }, h("span", { class: "etiqueta" }, "Respuesta"), h("p", {}, v.respuesta)),
          h("div", { class: "botones-respuesta", role: "group", "aria-label": "Qué tan bien te salió" },
            ...v.botones!.map((b) =>
              h("button", { type: "button", class: `boton calificar calificar-${b.boton}`, onclick: () => calificar(b.boton) },
                h("span", { class: "etiqueta-boton" }, b.etiqueta),
                h("span", { class: "intervalo" }, b.intervalo),
                h("kbd", {}, String(b.atajo))))))
      : boton("Ver respuesta", () => accion(() => repaso!.verRespuesta()), "grande principal", { "data-foco": "1" });
    return h("section", { class: "tarjeta-repaso" },
      h("p", { class: "suave" }, `${v.area} · quedan ${v.pendientes}`),
      h("h1", { class: "pregunta" }, v.pregunta),
      pista,
      v.respuestaVisible ? null : h("p", { class: "suave" }, "Pensá la respuesta y tocá “Ver respuesta” (o Espacio)."),
      zonaRespuesta,
      deshacer);
  }
  function calificar(b: Calificacion): void { accion(() => repaso!.calificar(b)); }

  // ---------- Tarjetas ----------
  async function dibujarTarjetas(): Promise<Node> {
    const buscador = h("input", {
      type: "search", id: "busqueda", placeholder: "Buscar en las tarjetas", value: busqueda, "aria-label": "Buscar tarjetas",
      oninput: (ev: Event) => { busqueda = (ev.target as HTMLInputElement).value; accion(() => undefined); },
    });
    const enPapelera = (await listarPapelera(d.almacen)).tarjetas;
    const partes: Hijo[] = [
      h("h1", {}, "Tarjetas"),
      h("div", { class: "barra" },
        boton(importAbierto ? "Cerrar importación" : "Importar", () => accion(() => { importAbierto = !importAbierto; }), "principal"),
        boton("Deshacer última importación", () => accion(async () => {
          const r = await deshacerUltimaImportacion(d.almacen, d.reloj);
          informe = null;
          aviso = r ? `Se deshizo la última importación: ${r.tarjetas} ${r.tarjetas === 1 ? "tarjeta pasó" : "tarjetas pasaron"} a la papelera.` : "No hay ninguna importación para deshacer.";
        }), "suave"),
        boton(`${papelera ? "Ocultar" : "Ver"} papelera (${enPapelera.length})`, () => accion(() => { papelera = !papelera; }), "suave")),
      importAbierto && dibujarImportar(),
      buscador,
    ];
    if (papelera) {
      partes.push(h("h2", {}, "Papelera"), enPapelera.length === 0
        ? h("p", { class: "suave" }, "La papelera está vacía.")
        : h("ul", { class: "lista" }, ...enPapelera.map((t) => h("li", {},
            h("span", {}, t.pregunta),
            boton("Restaurar", () => accion(async () => { await restaurarTarjeta(d.almacen, d.reloj, t.id); aviso = "Tarjeta restaurada."; }), "suave chico")))),
        h("p", { class: "suave" }, "Lo que está en la papelera se elimina a los 30 días."));
    }
    const grupos = await agruparTarjetas(d.almacen, busqueda);
    const opciones = await opcionesDeArea(d.almacen);
    if (grupos.length === 0) partes.push(h("p", { class: "suave" }, busqueda ? "No hay tarjetas que coincidan con la búsqueda." : "Todavía no hay tarjetas. Tocá “Importar” y pegá el JSON."));
    for (const g of grupos) {
      partes.push(h("h2", { class: "grupo" }, g.nombre),
        h("ul", { class: "lista tarjetas" }, ...g.tarjetas.map((t) => (editando === t.id ? formularioEdicion(t, opciones) : filaTarjeta(t)))));
    }
    return h("section", {}, ...partes);
  }

  function dibujarImportar(): Node {
    const caja = h("textarea", {
      id: "caja-importar", rows: 8, placeholder: "Pegá acá el JSON que generó Claude", "aria-label": "JSON para importar",
      oninput: (ev: Event) => { textoImport = (ev.target as HTMLTextAreaElement).value; },
    });
    (caja as HTMLTextAreaElement).value = textoImport;
    const partes: Hijo[] = [caja, boton("Confirmar importación", () => accion(async () => {
      const r = await importar(d.almacen, d.reloj, textoImport);
      informe = r;
      // Si hubo errores el texto queda en la caja para corregirlo; si no, se limpia.
      textoImport = r.errores.length > 0 ? r.texto_original : "";
    }), "principal")];
    if (informe) {
      partes.push(h("div", { class: "informe", role: "status" },
        h("p", {}, h("strong", {}, `Creadas: ${informe.creadas}`), ` · Duplicadas omitidas: ${informe.duplicadas} · Errores: ${informe.errores.length}`),
        informe.errores.length > 0 && h("ul", { class: "errores" }, ...informe.errores.map((e) => h("li", {}, e))),
        informe.avisos.length > 0 && h("ul", { class: "avisos" }, ...informe.avisos.map((a) => h("li", {}, a)))));
    }
    return h("div", { class: "importar" }, ...partes);
  }

  function filaTarjeta(t: Tarjeta): Node {
    return h("li", { class: t.suspendida ? "suspendida" : "" },
      h("div", { class: "texto" }, h("span", {}, t.pregunta), t.suspendida && h("em", {}, " (suspendida)"),
        h("span", { class: "suave" }, ` · vence ${formatearFecha(t.vence)}`)),
      h("div", { class: "acciones" },
        boton("Editar", () => accion(() => { editando = t.id; }), "suave chico"),
        boton(t.suspendida ? "Reanudar" : "Suspender", () => accion(async () => {
          await (t.suspendida ? reanudarTarjeta : suspenderTarjeta)(d.almacen, d.reloj, t.id);
        }), "suave chico"),
        boton("Borrar", () => accion(async () => { await borrarTarjeta(d.almacen, d.reloj, t.id); aviso = "Tarjeta enviada a la papelera. Podés restaurarla desde ahí."; }), "peligro chico")));
  }

  function formularioEdicion(t: Tarjeta, opciones: { id: Id; nombre: string }[]): Node {
    const pregunta = h("textarea", { rows: 2, "aria-label": "Pregunta" }, t.pregunta) as HTMLTextAreaElement;
    const respuesta = h("textarea", { rows: 3, "aria-label": "Respuesta" }, t.respuesta) as HTMLTextAreaElement;
    const pista = h("input", { type: "text", "aria-label": "Pista", value: t.pista ?? "" }) as HTMLInputElement;
    const area = h("select", { "aria-label": "Mover a" }, ...opciones.map((o) => h("option", { value: o.id, selected: o.id === t.area_id }, o.nombre))) as HTMLSelectElement;
    return h("li", { class: "edicion" },
      h("label", {}, "Pregunta", pregunta), h("label", {}, "Respuesta", respuesta), h("label", {}, "Pista (opcional)", pista),
      h("label", {}, "Área", area),
      h("div", { class: "acciones" },
        boton("Guardar", () => accion(async () => {
          await editarTarjeta(d.almacen, d.reloj, t.id, { pregunta: pregunta.value, respuesta: respuesta.value, pista: pista.value.trim() || null });
          if (area.value !== t.area_id) await moverTarjetaDeArea(d.almacen, d.reloj, t.id, area.value);
          editando = null;
          aviso = "Cambios guardados.";
        }), "principal chico"),
        boton("Cancelar", () => accion(() => { editando = null; }), "suave chico")));
  }

  // ---------- Ajustes ----------
  function dibujarAjustes(): Node {
    const aj = cargarAjustes(d.persistencia);
    const nuevas = h("input", { type: "number", id: "ajuste-nuevas", min: 0, max: 999, value: aj.nuevasPorDia }) as HTMLInputElement;
    const hora = h("input", { type: "time", id: "ajuste-hora", value: aj.horaCambio }) as HTMLInputElement;
    const guardar = () => accion(() => {
      const r = validarAjustes({ nuevasPorDia: nuevas.value, horaCambio: hora.value });
      if ("error" in r) { errorAjustes = r.error; return; }
      errorAjustes = "";
      guardarAjustes(d.persistencia, r.ajustes);
      aviso = "Ajustes guardados.";
    });
    nuevas.addEventListener("change", guardar);
    hora.addEventListener("change", guardar);
    return h("section", {},
      h("h1", {}, "Ajustes"),
      h("label", {}, "Tarjetas nuevas por día", nuevas),
      h("label", {}, "Hora de cambio de día", hora),
      h("p", { class: "suave" }, "A esa hora empieza el día nuevo para el repaso. Los cambios se guardan solos."),
      errorAjustes && h("p", { class: "aviso", role: "alert" }, errorAjustes));
  }

  // ---------- teclado ----------
  doc.addEventListener("keydown", (ev) => {
    if (pantalla !== "repaso" || !repaso) return;
    const ke = ev as KeyboardEvent;
    const tag = (ke.target as HTMLElement | null)?.tagName ?? "";
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if ((ke.ctrlKey || ke.metaKey) && ke.key.toLowerCase() === "z") {
      ke.preventDefault();
      accion(() => repaso!.deshacer());
    } else if (ke.key === " " && tag !== "BUTTON") {
      ke.preventDefault();
      accion(() => repaso!.verRespuesta());
    } else if (/^[1-4]$/.test(ke.key) && !ke.ctrlKey && !ke.metaKey && !ke.altKey) {
      const b = (["otra_vez", "dificil", "bien", "facil"] as const)[Number(ke.key) - 1]!;
      accion(() => repaso!.calificar(b));
    }
  });

  ir(inicial);
  return { ir, esperar: () => cola, raiz };
}
