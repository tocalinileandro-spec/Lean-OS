/**
 * Interfaz web del módulo 1 (DOM). Dibuja lo que devuelve logica.ts y atiende eventos.
 * Recibe todo por dependencias (almacén, reloj, persistencia) y usa el documento de la raíz,
 * así se puede montar en un DOM simulado.
 */
import { deshacerUltimaImportacion, importar, type InformeImportacion } from "../../compartido/importacion/importar.ts";
import { revisarImportacion, type BloqueRevisado, type RevisionImportacion } from "../../compartido/importacion/revision.ts";
import { importarRespaldoOriginal, type ArchivoAImportar, type InformeMigracion } from "../../compartido/migracion-original.ts";
import {
  borrarApunte, borrarTarjeta, crearTarjeta, editarTarjeta, moverTarjetaDeArea, reanudarTarjeta, suspenderTarjeta,
} from "../../compartido/gestion.ts";
import {
  convertirApunteATarea, convertirApunteATarjeta, crearApunte, editarApunte, tituloApunte, type BorradorTarjeta, type FiltrosApuntes,
} from "../../compartido/apuntes.ts";
import {
  borrarMeta, borrarTarea, cambiarEstadoMeta, crearMetaAnual, crearMetaTrimestral, crearTarea, crearTareaRapida, desmarcarHecha,
  detenerRepeticion, editarTarea, marcarHecha,
} from "../../compartido/tareas.ts";
import {
  borrarArea, borrarSubarea, borrarTema, contadoresDeRepaso, crearArea, detalleArea, moverTema, resumenAreas, resumenDeBorrado, restaurarArea, restaurarTema,
  type ContadoresDeRepaso, type GrupoDeTemas, type TemaDeArea,
} from "../../compartido/areas.ts";
import { diaLogico } from "../../compartido/dia.ts";
import type { ControlSync } from "../sync/motor.ts";
import { describirRepeticion, reglaValida, type Repeticion } from "../../compartido/recurrencia.ts";
import { TIPOS_APUNTE, type Apunte, type Calificacion, type EstadoMeta, type Id, type Tarea, type Tarjeta, type TipoApunte, type Trimestre } from "../../compartido/esquema.ts";
import {
  agruparTarjetas, aplicarTema, cargarAjustes, cargarTema, cantidadParaRepasar, fechaLarga, formatearFecha, guardarAjustes, guardarTema, mensajeDeError, nombreDeArea,
  lineasDeMigracion, opcionesDeArea, PantallaRepaso, saludoDelDia, TEMAS, validarAjustes, vistaHoy, type Tema, type Dependencias, type VistaRepaso,
} from "./logica.ts";
import {
  ESTADOS_META, etiquetaMeta, itemsPapelera, nombreTipoPapelera, restaurarItem, separarEtiquetas, textoProgreso,
  vistaApuntes, vistaTareas, type MetaConProgreso,
} from "./logica-tareas.ts";
import type { Estadisticas } from "../../compartido/estadisticas.ts";
import { datosGraficos } from "../../compartido/graficos.ts";
import { graficoRepasosPorDia, graficoRetencion, graficoTarjetasPorArea, graficoTareasPorSemana } from "./graficos-svg.ts";
import { crearIcono, type NombreIcono } from "./iconos.ts";
import { renderizarMarkdown } from "./markdown.ts";
import { detalleEstado, formatearInstante, textoEstado } from "../sync/estado.ts";
import { exportarLocal, importarRespaldo, lineasDeInforme, type InformeRespaldo } from "../sync/respaldo.ts";

export type Pantalla = "areas" | "hoy" | "repaso" | "tareas" | "apuntes" | "tarjetas" | "ajustes";
/** Pestañas de la navegación. "Áreas" es la pantalla de inicio (y el detalle de un área); Tarjetas (gestión) se abre desde Áreas y deja activa esa pestaña. */
const PESTANAS: { id: Pantalla; titulo: string; icono: NombreIcono }[] = [
  { id: "hoy", titulo: "Hoy", icono: "hoy" }, { id: "repaso", titulo: "Repaso", icono: "repaso" }, { id: "areas", titulo: "Áreas", icono: "areas" },
  { id: "tareas", titulo: "Tareas", icono: "tareas" }, { id: "apuntes", titulo: "Apuntes", icono: "apuntes" },
];
const TIPOS_NOMBRE: Record<TipoApunte, string> = { idea: "Idea", apunte: "Apunte", aprendizaje: "Aprendizaje" };
/** Campos que conservan el foco al redibujar (se está escribiendo en ellos). */
const CAMPOS_CON_FOCO = ["busqueda", "busqueda-apuntes", "tarea-rapida", "ver-estadisticas", "caja-importar"];
/** Cantidad de colores de la paleta cíclica de las áreas (clases `.area-c0` a `.area-c5` en el CSS). */
const COLORES_DE_AREA = 6;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

type Hijo = Node | string | null | false | undefined;
type Props = Record<string, string | number | boolean | ((ev: Event) => void) | undefined>;

export interface AppMontada {
  ir(p: Pantalla): void;
  /** Espera a que terminen todas las acciones en curso (para pruebas). */
  esperar(): Promise<void>;
  raiz: HTMLElement;
}

export function montarApp(raiz: HTMLElement, d: Dependencias, inicial: Pantalla = "areas"): AppMontada {
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
  /** Vista previa de "Revisar" (nada se crea hasta "Confirmar importación") y recordatorio de caja vacía. */
  let revision: RevisionImportacion | null = null;
  let recordatorioImport = "";
  /** Resumen del tema abierto desde el Repaso (solo lectura; no toca la sesión). */
  let resumenRepaso: { tema: string; etiqueta: string; texto: string } | null = null;
  /** Informe de la última importación del respaldo del Lean OS original (Ajustes). */
  let informeMigracion: InformeMigracion | null = null;
  let papelera = false;
  // Áreas: área abierta (detalle), menú de tema, resumen, mover, confirmación de borrado y "Deshacer".
  let areaAbierta: Id | null = null;
  let menuTema: Id | null = null;
  let resumenAbierto: Id | null = null;
  let moviendo: Id | null = null;
  interface Confirmacion { tipo: "tema" | "subarea" | "area"; id: Id; nombre: string }
  let confirmando: Confirmacion | null = null;
  let deshacerBorrado: { texto: string; restaurar: () => Promise<void> } | null = null;
  /** Mensaje en castellano pegado al formulario o fila donde ocurrió (clave = dónde). */
  let mensajeLocal: { clave: string; texto: string } | null = null;
  /** Id del elemento que recibe el foco después del próximo dibujo. */
  let focoEn: string | null = null;
  let editando: Id | null = null;
  let errorAjustes = "";
  let tareaEnForm: Id | "nueva" | null = null;
  let formMeta: "anual" | "trimestral" | null = null;
  let capturaAbierta = false;
  let errorCuenta = "";
  let informeRespaldo: InformeRespaldo | null = null;
  let cuentaDibujada = false;
  interface EstadoExterno { activo: boolean; configurado: boolean; ultimo_resultado: { cuando: string; ok: boolean; mensaje: string } | null }
  let externo: EstadoExterno | null = null;
  let errorExterno = "";
  /** Entrada por audio (opcional): último estado conocido del servidor, en memoria. null = nunca consultado. */
  interface EstadoAudio { activo: boolean; configurado: boolean }
  let audioEstado: EstadoAudio | null = null;
  let audioSinConexion = false;
  let errorAudioAjustes = "";
  let capturaConsultada = false;
  type FaseGrabacion = "" | "pidiendo" | "grabando" | "transcribiendo";
  let faseAudio: FaseGrabacion = "";
  let mensajeAudio = "";
  let grabadora: { detener(descartar: boolean): void } | null = null;
  let versionVista = 0;
  let apunteEnEdicion: Id | null = null;
  let borradorTarjeta: { apunteId: Id; b: BorradorTarjeta } | null = null;
  const filtros = { texto: "", tipo: "", etiqueta: "", area: "" };
  const firmaForm = () => [tareaEnForm, formMeta, apunteEnEdicion, borradorTarjeta?.apunteId].join("|");
  /** Lo escrito en los formularios abiertos: sobrevive a los redibujados y se limpia al guardar, cancelar o cambiar de formulario. */
  const recuerdo = new Map<string, string>();
  const previo = (id: string, defecto: string) => recuerdo.get(id) ?? defecto;
  const recordar = (...els: (HTMLElement | null)[]) => { for (const e of els) if (e) recuerdo.set(e.id, (e as HTMLInputElement).value); };
  /** Hace que cada campo con id del formulario guarde su valor en `recuerdo` mientras se escribe. */
  function recordando(form: HTMLElement): HTMLElement {
    for (const e of form.querySelectorAll<HTMLElement>("input[id], textarea[id], select[id]")) {
      const guardar = () => recordar(e);
      e.addEventListener("input", guardar);
      e.addEventListener("change", guardar);
    }
    return form;
  }
  let cola: Promise<void> = Promise.resolve();
  /** Panel de estadísticas de Hoy (solo lee datos; no es una pantalla de la navegación). */
  let panelEstadisticas = false;

  /** Serializa las acciones: una a la vez, y siempre se redibuja al final. */
  function accion(f: () => Promise<void> | void): void {
    cola = cola.then(async () => {
      aviso = ""; errorAjustes = ""; mensajeLocal = null;
      const antes = firmaForm();
      await f();
      if (firmaForm() !== antes) recuerdo.clear(); // se cerró o cambió el formulario: lo escrito ya no vale
    }).catch((e) => { aviso = mensajeDeError(e); }).then(dibujar);
  }

  /** Redibuja sin tocar los avisos (lo usa la sincronización en segundo plano). */
  function redibujar(): void {
    cola = cola.then(dibujar);
  }

  /** Cierra menús, formularios y avisos propios de Áreas (al cambiar de pantalla o de área). */
  function limpiarAreas(): void {
    areaAbierta = null; menuTema = null; resumenAbierto = null; moviendo = null; confirmando = null; deshacerBorrado = null; mensajeLocal = null;
    resumenRepaso = null; informeMigracion = null;
    limpiarResultadosImportar();
  }

  /** La caja de importar nunca arrastra errores, informes ni conteos de una vez anterior (P9). Lo pegado se conserva. */
  function limpiarResultadosImportar(): void {
    informe = null; revision = null; recordatorioImport = "";
  }

  function ir(p: Pantalla): void {
    panelEstadisticas = false;
    if (p !== "apuntes") grabadora?.detener(true);
    accion(async () => {
      pantalla = p;
      aviso = "";
      limpiarAreas();
      repaso = p === "repaso" ? await PantallaRepaso.iniciar(d) : null;
    });
  }

  function abrirArea(id: Id): void {
    accion(() => { pantalla = "areas"; repaso = null; limpiarAreas(); areaAbierta = id; focoEn = "titulo-pantalla"; });
  }

  function volverAAreas(): void {
    accion(() => { limpiarAreas(); focoEn = "titulo-pantalla"; });
  }

  /** Repaso filtrado por un área (o subárea). */
  function repasarArea(areaId: Id): void {
    accion(async () => { pantalla = "repaso"; limpiarAreas(); repaso = await PantallaRepaso.iniciar(d, { areaId }); });
  }

  /** Abre Tarjetas con la caja de importar. */
  function abrirImportar(): void {
    accion(() => { pantalla = "tarjetas"; repaso = null; limpiarAreas(); importAbierto = true; textoImport = ""; });
  }

  // ---------- estructura ----------
  const cabecera = h("div", { class: "cabecera" });
  const nav = h("nav", { "aria-label": "Pantallas", class: "nav" });
  const estadoSlot = h("span", { class: "estado-slot" });
  const botonAjustes = h("button", { type: "button", id: "ir-ajustes", class: "boton-icono", "aria-label": "Ajustes", title: "Ajustes", onclick: () => ir("ajustes") });
  botonAjustes.append(crearIcono(doc, "ajustes"));
  const barra = h("header", { class: "barra-superior" },
    h("div", { class: "marca" }, h("span", { class: "marca-punto", "aria-hidden": "true" }), h("span", {}, "Lean OS")),
    nav,
    h("div", { class: "barra-acciones" }, estadoSlot, botonAjustes));
  const principal = h("main", { id: "principal", tabindex: "-1" });
  raiz.replaceChildren(barra, cabecera, principal);

  /** Indicador de sincronización (y pedido de confirmación de borrado masivo) siempre visible arriba. */
  function dibujarCabecera(): void {
    const s = d.sync;
    if (!s) return;
    const e = s.estado();
    estadoSlot.replaceChildren(h("button", {
      type: "button", id: "estado-sync", class: `estado-sync estado-${e.fase}`, title: "Ver el detalle en Ajustes", onclick: () => ir("ajustes"),
    }, textoEstado(e)));
    cabecera.replaceChildren(
      ...(e.confirmacion ? [h("div", { class: "aviso confirmar-borrado", role: "alert" },
        h("p", {}, e.confirmacion.mensaje),
        boton("Confirmar y sincronizar", () => { void s.confirmarBorradoMasivo(); }, "peligro chico"))] : []));
  }

  /** Detalle del estado en Ajustes: se actualiza en el lugar, sin redibujar (no se pierde lo que se está escribiendo). */
  function dibujarDetalleSync(): void {
    const s = d.sync;
    const el = principal.querySelector("#detalle-sync");
    if (!s || !el) return;
    const e = s.estado();
    const partes = [`Estado: ${textoEstado(e)}.`, detalleEstado(e)];
    if (e.ultimaVez) partes.push(`Última sincronización: ${formatearInstante(e.ultimaVez)}.`);
    el.textContent = partes.join(" ");
    for (const ins of principal.querySelectorAll<HTMLElement>(".insignia-sync")) {
      ins.className = `insignia-estado insignia-sync ${e.fase === "sincronizado" ? "estado-aldia" : e.fase === "error" || e.fase === "sesion_vencida" || e.fase === "confirmacion_pendiente" ? "estado-error" : "estado-nuevo"}`;
      ins.textContent = textoEstado(e);
    }
  }

  if (d.sync) {
    d.sync.suscribir((e) => {
      dibujarCabecera();
      dibujarDetalleSync();
      const act = doc.activeElement as HTMLElement | null;
      const escribiendo = !!act && ["INPUT", "TEXTAREA", "SELECT"].includes(act.tagName);
      const cambioCuenta = pantalla === "ajustes" && d.sync!.hayCuenta() !== cuentaDibujada;
      // Llegaron datos nuevos del servidor (o cambió la cuenta): se redibuja la pantalla si no se está escribiendo.
      if (!escribiendo && (e.versionDatos !== versionVista || cambioCuenta)) redibujar();
    });
  }

  async function dibujar(): Promise<void> {
    if (d.sync) {
      await d.sync.refrescar();
      versionVista = d.sync.estado().versionDatos;
      dibujarCabecera();
    }
    let pendientesRepaso = 0;
    try { pendientesRepaso = await cantidadParaRepasar(d); } catch { /* sin insignia si no se pueden contar */ }
    nav.replaceChildren(...PESTANAS.map((p) =>
      h("button", { type: "button", class: "nav-item", "aria-current": p.id === pantalla || (p.id === "areas" && pantalla === "tarjetas") ? "page" : undefined, onclick: () => ir(p.id) },
        h("span", { class: "nav-icono" }, crearIcono(doc, p.icono)),
        h("span", { class: "nav-texto" }, p.titulo),
        p.id === "repaso" && pendientesRepaso > 0 && h("span", { class: "insignia", "aria-label": `${pendientesRepaso} pendientes` }, String(pendientesRepaso)))));
    if (pantalla === "ajustes") botonAjustes.setAttribute("aria-current", "page"); else botonAjustes.removeAttribute("aria-current");
    const activo = doc.activeElement as HTMLElement | null;
    const idActivo = activo && activo !== doc.body ? activo.id : "";
    const contenido: Hijo[] = [];
    if (aviso) contenido.push(h("p", { class: "aviso", role: "status" }, aviso));
    if (!capturaAbierta || pantalla !== "apuntes") capturaConsultada = false;
    else if (!capturaConsultada) { capturaConsultada = true; await cargarAudio(); }
    try {
      if (pantalla === "areas") contenido.push(await dibujarAreas());
      else if (pantalla === "hoy") contenido.push(await dibujarHoy());
      else if (pantalla === "repaso") contenido.push(await dibujarRepaso());
      else if (pantalla === "tareas") contenido.push(await dibujarTareas());
      else if (pantalla === "apuntes") contenido.push(await dibujarApuntes());
      else if (pantalla === "tarjetas") contenido.push(await dibujarTarjetas());
      else {
        await cargarExterno();
        await cargarAudio();
        contenido.push(dibujarAjustes());
      }
    } catch (e) {
      contenido.push(h("p", { class: "aviso", role: "alert" }, mensajeDeError(e)));
    }
    principal.replaceChildren(...contenido.filter((x): x is Node => !!x));
    dibujarDetalleSync();
    // En el celular las filas de chips se deslizan: el chip elegido queda a la vista.
    for (const fila of principal.querySelectorAll<HTMLElement>(".chips-fila")) {
      const elegido = fila.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (elegido) fila.scrollLeft = Math.max(0, elegido.offsetLeft - (fila.clientWidth - elegido.offsetWidth) / 2);
    }
    // Si se estaba escribiendo en un campo (búsqueda), se conserva el foco; si no, va a la acción principal.
    const mismo = idActivo ? principal.querySelector<HTMLInputElement>(`[id="${idActivo}"]`) : null;
    const pedido = focoEn ? principal.querySelector<HTMLElement>(`[id="${focoEn}"]`) : null;
    focoEn = null;
    if (pedido) {
      pedido.focus();
    } else if (mismo && (CAMPOS_CON_FOCO.includes(mismo.id) || mismo.id.startsWith("a-"))) {
      mismo.focus();
      mismo.setSelectionRange?.(mismo.value.length, mismo.value.length);
    } else {
      principal.querySelector<HTMLElement>("[data-foco]")?.focus?.();
    }
  }

  // ---------- Áreas (inicio) y detalle de área ----------
  const claseColor = (i: number) => `area-c${i % COLORES_DE_AREA}`;
  const inicialDe = (nombre: string) => ([...nombre.trim()][0] ?? "?").toUpperCase();
  const mensajeDe = (clave: string): Node | null => (mensajeLocal?.clave === clave ? h("p", { class: "aviso", role: "alert" }, mensajeLocal.texto) : null);
  const botonConIcono = (texto: string, icono: NombreIcono, onclick: () => void, clase: string, extra: Props = {}) =>
    h("button", { type: "button", class: `boton ${clase}`.trim(), onclick: () => onclick(), ...extra }, texto, crearIcono(doc, icono));

  /** Encabezado de pantalla: fecha opcional, el único h1, subtítulo y la acción principal a la derecha. */
  const encabezado = (titulo: string, subtitulo: string, o: { fecha?: string; accion?: Hijo } = {}) =>
    h("div", { class: "encabezado-pantalla" },
      h("div", {}, o.fecha && h("p", { class: "fecha-pantalla" }, o.fecha), h("h1", {}, titulo), subtitulo && h("p", { class: "suave subtitulo" }, subtitulo)),
      o.accion);
  /** Estado vacío: ícono sobrio, el mensaje y, si hay, la acción. */
  const vacioConIcono = (icono: NombreIcono, texto: string, accionVacia?: Hijo) =>
    h("div", { class: "vacio-estado" }, h("span", { class: "vacio-icono", "aria-hidden": "true" }, crearIcono(doc, icono)), h("p", {}, texto), accionVacia);
  /** Campo de búsqueda pastilla con la lupa a la izquierda. */
  const conLupa = (campo: HTMLElement) => h("div", { class: "buscador" }, h("span", { class: "buscador-icono", "aria-hidden": "true" }, crearIcono(doc, "buscar")), campo);
  /** Bloque de pantalla con su h2. */
  const bloque = (titulo: string, ...hijos: Hijo[]) => h("section", { class: "bloque" }, h("h2", {}, titulo), ...hijos);

  /** "Se van a la papelera" ya hecho: aviso con "Deshacer" (restaura el conjunto con el mismo instante de borrado). */
  function avisoDeshacer(): Node | null {
    const b = deshacerBorrado;
    if (!b) return null;
    return h("div", { class: "aviso aviso-accion", role: "status" },
      h("span", {}, b.texto),
      boton("Deshacer", () => accion(async () => { deshacerBorrado = null; await b.restaurar(); focoEn = "titulo-pantalla"; }), "suave chico", { id: "a-deshacer" }));
  }

  /** Campo de nombre + botón para crear un área o una subárea. Enter también crea; si falla o está repetida, lo escrito queda. */
  function formularioNuevo(o: { id: string; etiqueta: string; placeholder: string; boton: string; padreId: Id | null }): Node {
    const campo = h("input", { type: "text", id: o.id, placeholder: o.placeholder, autocomplete: "off", value: previo(o.id, ""), maxlength: 120 }) as HTMLInputElement;
    const crear = () => accion(async () => {
      recordar(campo);
      try {
        const r = await crearArea(d.almacen, d.reloj, campo.value, o.padreId);
        if (!r.creada) { mensajeLocal = { clave: o.id, texto: r.aviso ?? "Ya existe." }; focoEn = o.id; return; }
        recuerdo.delete(o.id);
        if (o.padreId === null) { limpiarAreas(); areaAbierta = r.area.id; focoEn = "titulo-pantalla"; aviso = `Área “${r.area.nombre}” creada.`; }
        else { aviso = `Subárea “${r.area.nombre}” creada.`; focoEn = o.id; }
      } catch (e) {
        mensajeLocal = { clave: o.id, texto: mensajeDeError(e) };
        focoEn = o.id;
      }
    });
    campo.addEventListener("keydown", (ev) => {
      const ke = ev as KeyboardEvent;
      if (ke.key !== "Enter" || ke.isComposing) return;
      ke.preventDefault();
      crear();
    });
    return recordando(h("div", { class: "formulario-nuevo", role: "group", "aria-label": o.etiqueta },
      h("span", { class: "formulario-icono" }, crearIcono(doc, "mas")),
      h("label", { for: o.id }, o.etiqueta),
      campo,
      boton(o.boton, crear, "oscuro"),
      mensajeDe(o.id)));
  }

  async function dibujarAreas(): Promise<Node> {
    if (areaAbierta) {
      const a = await d.almacen.areas.obtener(areaAbierta);
      if (a && a.deleted_at === null) return dibujarDetalleArea(areaAbierta);
      areaAbierta = null; // ya no existe (por ejemplo, la borraron desde otro dispositivo)
    }
    const aj = cargarAjustes(d.persistencia);
    const r = await resumenAreas(d.almacen, d.reloj, { limiteNuevas: aj.nuevasPorDia });
    const totalTarjetas = r.areas.reduce((n, a) => n + a.tarjetas, 0);
    const subtitulo = r.areas.length === 0
      ? "Todavía no tenés áreas."
      : `${plural(totalTarjetas, "tarjeta", "tarjetas")} en ${plural(r.areas.length, "área", "áreas")}. Elegí una para estudiarla o repasá todo lo de hoy.`;
    const encabezado = h("div", { class: "encabezado-pantalla" },
      h("div", {},
        h("p", { class: "fecha-pantalla" }, fechaLarga(diaLogico(d.reloj))),
        h("h1", { id: "titulo-pantalla", tabindex: "-1" }, "Tus áreas"),
        h("p", { class: "suave subtitulo" }, subtitulo)),
      r.totalParaHoy > 0 && botonConIcono(`Repasar hoy · ${r.totalParaHoy}`, "siguiente", () => ir("repaso"), "principal grande-cta", { id: "a-repasar-hoy" }));
    if (r.areas.length === 0) {
      return h("section", { class: "pantalla-areas" }, encabezado, avisoDeshacer(),
        h("div", { class: "vacio-areas" },
          h("p", {}, "Cada área junta los temas que estudiás, por ejemplo Programación o Idiomas. Creá la primera o importá tarjetas ya armadas."),
          formularioNuevo({ id: "a-nueva-area", etiqueta: "Nueva área", placeholder: "Ej: Finanzas, Idiomas…", boton: "Crear área", padreId: null }),
          boton("Importar", abrirImportar, "suave", { id: "a-importar" })));
    }
    const tarjetas = r.areas.map((a, i) => h("li", { class: `area-tarjeta ${claseColor(i)}` },
      h("div", { class: "area-cabeza" },
        h("span", { class: "area-inicial", "aria-hidden": "true" }, a.inicial),
        h("span", { class: `insignia-estado ${a.paraHoy > 0 ? "estado-hoy" : "estado-aldia"}` }, a.paraHoy > 0 ? `${a.paraHoy} para hoy` : "Al día")),
      h("h2", { class: "area-nombre" },
        h("button", { type: "button", class: "area-abrir", id: `a-abrir-${a.id}`, onclick: () => abrirArea(a.id) }, a.nombre)),
      h("p", { class: "suave area-detalle" }, `${plural(a.tarjetas, "tarjeta", "tarjetas")} · ${plural(a.subareas.length, "subárea", "subáreas")}`),
      a.subareas.length > 0 && h("ul", { class: "etiquetas-sub", "aria-label": `Subáreas de ${a.nombre}` }, ...a.subareas.map((n) => h("li", {}, n))),
      h("div", { class: "area-dominio" },
        h("div", { class: "area-dominio-texto" }, h("span", { id: `a-dominio-${a.id}` }, "Dominadas"), h("strong", {}, `${a.dominio}%`)),
        h("progress", { role: "progressbar", max: 100, value: a.dominio, "aria-labelledby": `a-dominio-${a.id}`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": a.dominio, "aria-valuetext": `${a.dominio}%` }))));
    return h("section", { class: "pantalla-areas" }, encabezado, avisoDeshacer(),
      h("ul", { class: "areas-grilla" }, ...tarjetas),
      formularioNuevo({ id: "a-nueva-area", etiqueta: "Nueva área", placeholder: "Ej: Finanzas, Idiomas…", boton: "Crear área", padreId: null }),
      h("div", { class: "barra" }, boton("Ver todas las tarjetas", () => ir("tarjetas"), "suave", { id: "a-ver-tarjetas" })));
  }

  /** A dónde vuelve el foco al cerrar con Escape o Cancelar lo que abrió ese elemento. */
  const disparadorDe = (c: Confirmacion): string => (c.tipo === "tema" ? `a-menu-${c.id}` : c.tipo === "subarea" ? `a-borrar-sub-${c.id}` : "a-borrar-area");

  function pedirConfirmacion(c: Confirmacion): void {
    accion(() => { confirmando = c; menuTema = null; focoEn = `a-confirmar-no-${c.id}`; });
  }

  function confirmarBorrado(c: Confirmacion): void {
    accion(async () => {
      confirmando = null; menuTema = null; moviendo = null;
      if (c.tipo === "tema") {
        await borrarTema(d.almacen, d.reloj, c.id);
        deshacerBorrado = {
          texto: `Tema “${c.nombre}” quedó en la papelera 30 días.`,
          restaurar: async () => { await restaurarTema(d.almacen, d.reloj, c.id); aviso = `Tema “${c.nombre}” restaurado con sus tarjetas y su resumen.`; },
        };
      } else if (c.tipo === "subarea") {
        await borrarSubarea(d.almacen, d.reloj, c.id);
        deshacerBorrado = {
          texto: `Subárea “${c.nombre}” quedó en la papelera 30 días.`,
          restaurar: async () => { await restaurarArea(d.almacen, d.reloj, c.id); aviso = `Subárea “${c.nombre}” restaurada con todo lo que tenía.`; },
        };
      } else {
        await borrarArea(d.almacen, d.reloj, c.id);
        areaAbierta = null; // vuelve a Áreas
        deshacerBorrado = {
          texto: `Área “${c.nombre}” quedó en la papelera 30 días.`,
          restaurar: async () => { await restaurarArea(d.almacen, d.reloj, c.id); areaAbierta = c.id; aviso = `Área “${c.nombre}” restaurada con todo lo que tenía.`; },
        };
      }
      focoEn = "titulo-pantalla";
    });
  }

  /** Pregunta de confirmación en el lugar, con lo que se va (de `resumenDeBorrado`). */
  function nodoConfirmacion(c: Confirmacion, texto: string): Node {
    const que = c.tipo === "tema" ? "el tema" : c.tipo === "subarea" ? "la subárea" : "el área";
    return h("div", { class: "confirmacion", role: "alert", id: `a-confirmar-${c.id}` },
      h("p", {}, h("strong", {}, `¿Borrar ${que} “${c.nombre}”?`), ` ${texto}`),
      h("div", { class: "acciones" },
        boton("Mover a la papelera", () => confirmarBorrado(c), "peligro", { id: `a-confirmar-si-${c.id}` }),
        boton("Cancelar", () => accion(() => { confirmando = null; focoEn = disparadorDe(c); }), "suave", { id: `a-confirmar-no-${c.id}` })));
  }

  function filaTema(t: TemaDeArea, areaActual: Id, destinos: { id: Id; nombre: string }[], confirmacion: Node | null): Node {
    const abierto = menuTema === t.id;
    const idMenu = `a-menu-${t.id}`;
    const botonMenu = h("button", {
      type: "button", class: "boton-icono", id: idMenu, "aria-label": `Más opciones de ${t.nombre}`, "aria-expanded": abierto ? "true" : "false", "aria-controls": `a-opciones-${t.id}`,
      onclick: () => accion(() => { menuTema = abierto ? null : t.id; focoEn = abierto ? idMenu : `a-ver-resumen-${t.id}`; }),
    }, crearIcono(doc, "tres-puntos"));
    const menu = abierto && h("div", { class: "menu-opciones", id: `a-opciones-${t.id}`, role: "group", "aria-label": `Opciones de ${t.nombre}` },
      boton("Ver el resumen", () => accion(() => { resumenAbierto = resumenAbierto === t.id ? null : t.id; menuTema = null; focoEn = idMenu; }), "suave chico", { id: `a-ver-resumen-${t.id}` }),
      boton("Mover…", () => accion(() => { moviendo = t.id; menuTema = null; focoEn = `a-mover-destino-${t.id}`; }), "suave chico"),
      boton("Borrar tema", () => pedirConfirmacion({ tipo: "tema", id: t.id, nombre: t.nombre }), "peligro chico"));
    const resumen = resumenAbierto === t.id && h("div", { class: "resumen-tema", id: `a-resumen-${t.id}` },
      h("h3", {}, `Resumen de ${t.nombre}`),
      t.resumen ? renderizarMarkdown(doc, t.resumen) : h("p", { class: "suave" }, "Este tema no tiene resumen."),
      boton("Cerrar resumen", () => accion(() => { resumenAbierto = null; focoEn = idMenu; }), "suave chico"));
    return h("li", { class: "fila-tema" },
      h("div", { class: "fila-tema-linea" },
        h("div", { class: "fila-tema-texto" }, h("div", { class: "fila-tema-nombre" }, t.nombre), h("div", { class: "suave fila-tema-detalle" }, plural(t.tarjetas, "tarjeta", "tarjetas"))),
        h("span", { class: `insignia-estado estado-${t.estado === "hoy" ? "hoy" : t.estado === "nuevo" ? "nuevo" : "aldia"}` }, t.estadoTexto),
        botonMenu),
      menu, resumen,
      moviendo === t.id && formularioMover(t, areaActual, destinos),
      confirmacion);
  }

  function formularioMover(t: TemaDeArea, areaActual: Id, destinos: { id: Id; nombre: string }[]): Node {
    const idSel = `a-mover-destino-${t.id}`;
    const sel = h("select", { id: idSel, "aria-label": `Mover “${t.nombre}” a` },
      ...destinos.map((o) => h("option", { value: o.id }, o.id === areaActual ? `${o.nombre} (está acá)` : o.nombre))) as HTMLSelectElement;
    sel.value = previo(idSel, destinos.find((o) => o.id !== areaActual)?.id ?? areaActual);
    const cerrar = () => { recuerdo.delete(idSel); moviendo = null; focoEn = `a-menu-${t.id}`; };
    return recordando(h("div", { class: "mover-tema", role: "group", "aria-label": `Mover ${t.nombre}` },
      h("label", { for: idSel }, `Mover “${t.nombre}” a`),
      sel,
      h("div", { class: "acciones" },
        boton("Mover", () => accion(async () => {
          recordar(sel);
          const destino = destinos.find((o) => o.id === sel.value);
          try {
            const r = await moverTema(d.almacen, d.reloj, t.id, sel.value);
            recuerdo.delete(idSel);
            moviendo = null;
            aviso = `Se movió “${t.nombre}” a “${destino?.nombre ?? "el destino"}” con ${plural(r.tarjetas, "tarjeta", "tarjetas")}: conservan su estado de repaso.`;
            focoEn = "titulo-pantalla";
          } catch (e) {
            mensajeLocal = { clave: `mover:${t.id}`, texto: mensajeDeError(e) };
            focoEn = idSel;
          }
        }), "principal chico"),
        boton("Cancelar", () => accion(cerrar), "suave chico")),
      mensajeDe(`mover:${t.id}`)));
  }

  function seccionGrupo(g: GrupoDeTemas, o: { titulo: string; esSubarea: boolean; conRepasar: boolean; destinos: { id: Id; nombre: string }[]; textoConfirmacion: string }): Node {
    const idTitulo = `a-seccion-${g.areaId}`;
    const confirmacionTema = (t: TemaDeArea) => (confirmando?.tipo === "tema" && confirmando.id === t.id ? nodoConfirmacion(confirmando, o.textoConfirmacion) : null);
    const hayAlgo = g.temas.length > 0 || g.tarjetasSueltas > 0;
    return h("section", { class: "seccion-area", "aria-labelledby": idTitulo },
      h("div", { class: "seccion-cabeza" },
        h("div", {},
          h("h2", { id: idTitulo }, o.titulo),
          h("p", { class: "suave" }, `${plural(g.tarjetas, "tarjeta", "tarjetas")} · ${plural(g.temas.length, "tema", "temas")}`)),
        o.conRepasar && g.paraHoy > 0 && boton(`Repasar · ${g.paraHoy}`, () => repasarArea(g.areaId), "suave chico", { "aria-label": `Repasar ${o.titulo} · ${g.paraHoy}` })),
      hayAlgo
        ? h("ul", { class: "lista-temas" },
            ...g.temas.map((t) => filaTema(t, g.areaId, o.destinos, confirmacionTema(t))),
            g.tarjetasSueltas > 0 && h("li", { class: "fila-tema" },
              h("div", { class: "fila-tema-linea" },
                h("div", { class: "fila-tema-texto" }, h("div", { class: "fila-tema-nombre" }, "Tarjetas sueltas"), h("div", { class: "suave fila-tema-detalle" }, plural(g.tarjetasSueltas, "tarjeta", "tarjetas"))))))
        : h("p", { class: "suave" }, "Todavía no hay temas acá. Importá tarjetas para empezar."),
      o.esSubarea && h("div", { class: "acciones pie-seccion" },
        boton("Borrar subárea", () => pedirConfirmacion({ tipo: "subarea", id: g.areaId, nombre: g.nombre }), "peligro chico", { id: `a-borrar-sub-${g.areaId}`, "aria-label": `Borrar subárea ${g.nombre}` })),
      o.esSubarea && confirmando?.tipo === "subarea" && confirmando.id === g.areaId && nodoConfirmacion(confirmando, o.textoConfirmacion));
  }

  async function dibujarDetalleArea(id: Id): Promise<Node> {
    const aj = cargarAjustes(d.persistencia);
    const det = await detalleArea(d.almacen, d.reloj, id, { limiteNuevas: aj.nuevasPorDia });
    const todas = await d.almacen.areas.listar();
    const raices = todas.filter((a) => a.padre_id === null).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
    const raizId = det.padreId ?? det.id;
    const indice = Math.max(0, raices.findIndex((a) => a.id === raizId));
    // Destinos de "Mover…": todas las áreas y subáreas vivas.
    const destinos = raices.flatMap((r) => [
      { id: r.id, nombre: r.nombre },
      ...todas.filter((s) => s.padre_id === r.id).sort((x, y) => x.nombre.localeCompare(y.nombre, "es")).map((s) => ({ id: s.id, nombre: `${r.nombre} › ${s.nombre}` })),
    ]);
    // Texto de la confirmación (lo que se va a la papelera); si el objetivo ya no existe, se cierra.
    let textoConfirmacion = "";
    if (confirmando) {
      try { textoConfirmacion = (await resumenDeBorrado(d.almacen, { tipo: confirmando.tipo === "tema" ? "tema" : "area", id: confirmando.id })).texto; } catch { confirmando = null; }
    }
    const grupoPropio = det.propio.temas.length > 0 || det.propio.tarjetasSueltas > 0 || det.subareas.length === 0;
    const esRaiz = det.padreId === null;
    const secciones = [
      ...(grupoPropio ? [seccionGrupo(det.propio, {
        titulo: det.subareas.length > 0 ? `${det.nombre} (sin subárea)` : det.nombre, esSubarea: false, conRepasar: det.subareas.length === 0, destinos, textoConfirmacion,
      })] : []),
      ...det.subareas.map((g) => seccionGrupo(g, { titulo: g.nombre, esSubarea: true, conRepasar: true, destinos, textoConfirmacion })),
    ];
    return h("section", { class: `pantalla-detalle ${claseColor(indice)}` },
      h("button", { type: "button", class: "enlace-volver", id: "a-volver", onclick: volverAAreas }, crearIcono(doc, "volver"), "Todas las áreas"),
      h("div", { class: "encabezado-pantalla" },
        h("div", { class: "detalle-titulo" },
          h("span", { class: "area-inicial grande", "aria-hidden": "true" }, inicialDe(det.nombre)),
          h("div", {},
            h("h1", { id: "titulo-pantalla", tabindex: "-1" }, det.titulo),
            h("p", { class: "suave subtitulo" }, `${plural(det.tarjetas, "tarjeta", "tarjetas")} · ${plural(det.subareas.length, "subárea", "subáreas")} · ${det.paraHoy} para repasar hoy`))),
        h("div", { class: "acciones" },
          det.paraHoy > 0 && boton(`Repasar esta área · ${det.paraHoy}`, () => repasarArea(det.id), "principal", { id: "a-repasar-area" }),
          boton("Importar tarjetas", abrirImportar, "suave", { id: "a-importar" }))),
      avisoDeshacer(),
      h("div", { class: "secciones-area" }, ...secciones),
      esRaiz && formularioNuevo({ id: "a-nueva-subarea", etiqueta: "Nueva subárea", placeholder: "Ej: Python, Bases de datos…", boton: "Crear", padreId: det.id }),
      h("div", { class: "nota-papelera" }, crearIcono(doc, "papelera"),
        h("p", {}, h("strong", {}, "Papelera:"), " lo que borres queda 30 días y podés restaurarlo desde Tarjetas, en “Ver papelera”.")),
      esRaiz && h("section", { class: "zona-peligro", "aria-labelledby": "a-zona-peligro" },
        h("h2", { id: "a-zona-peligro" }, "Zona de peligro"),
        h("p", { class: "suave" }, "Borrar el área manda a la papelera sus subáreas, temas y tarjetas. Podés deshacerlo durante 30 días."),
        boton("Borrar área", () => pedirConfirmacion({ tipo: "area", id: det.id, nombre: det.nombre }), "peligro", { id: "a-borrar-area" }),
        confirmando?.tipo === "area" && confirmando.id === det.id && nodoConfirmacion(confirmando, textoConfirmacion)));
  }

  // ---------- Hoy ----------
  async function dibujarHoy(): Promise<Node> {
    const v = await vistaHoy(d);
    const e = v.estadisticas;
    const rapida = h("input", {
      type: "text", id: "tarea-rapida", class: "campo-pastilla", placeholder: "Tarea rápida: escribí el título y apretá Enter", "aria-label": "Tarea rápida", autocomplete: "off",
      onkeydown: (ev: Event) => {
        const ke = ev as KeyboardEvent;
        if (ke.key !== "Enter" || ke.isComposing) return;
        ke.preventDefault();
        crearRapida();
      },
    }) as HTMLInputElement;
    function crearRapida(): void {
      const titulo = rapida.value;
      if (!titulo.trim()) return;
      rapida.value = ""; // un segundo Enter seguido ya no encuentra nada para crear
      accion(async () => { await crearTareaRapida(d.almacen, d.reloj, titulo); });
    }
    const tareasHoy = v.atrasadas.length + v.tareas.length;
    const partes = [tareasHoy > 0 && plural(tareasHoy, "tarea", "tareas"), v.pendientes > 0 && plural(v.pendientes, "tarjeta", "tarjetas")].filter(Boolean);
    const resumen = partes.length > 0 ? `Tenés ${partes.join(" y ")} para hoy.` : "No tenés nada pendiente para hoy.";
    const repasar = v.pendientes > 0
      ? h("div", { class: "acceso-fijo" },
          botonConIcono(`Repasar ${v.pendientes} ${v.pendientes === 1 ? "tarjeta" : "tarjetas"}`, "siguiente", () => ir("repaso"), "principal grande-cta", { "data-foco": "1" }))
      : null;
    return h("section", { class: `pantalla-hoy${repasar ? " con-acceso" : ""}` },
      encabezado("Hoy", `${saludoDelDia(d.reloj.ahora())}. ${resumen}`, { fecha: `${fechaLarga(diaLogico(d.reloj))} · ${v.fecha}`, accion: repasar }),
      h("dl", { class: "estadisticas" },
        h("div", {}, h("dt", {}, "Pendientes hoy"), h("dd", {}, String(e.pendientesHoy))),
        h("div", {}, h("dt", {}, "Repasadas hoy"), h("dd", {}, String(e.repasadasHoy))),
        h("div", {}, h("dt", {}, "Racha"), h("dd", {}, `${e.racha} ${e.racha === 1 ? "día" : "días"}`))),
      v.atrasadas.length > 0 && h("div", { class: "atrasadas", role: "region", "aria-label": "Tareas atrasadas" },
        h("h2", {}, `Atrasadas (${v.atrasadas.length})`),
        h("ul", { class: "lista tareas" }, ...v.atrasadas.map((t) => filaTarea(t, { fecha: true })))),
      bloque("Tareas de hoy",
        h("div", { class: "tarea-rapida" }, rapida, botonConIcono("Agregar", "mas", crearRapida, "principal", { id: "tarea-rapida-agregar" })),
        v.tareas.length === 0
          ? vacioConIcono("tareas", "No tenés tareas para hoy. Escribí una arriba y apretá Enter.")
          : h("ul", { class: "lista tareas" }, ...v.tareas.map((t) => filaTarea(t, {})))),
      !repasar && vacioConIcono("repaso", "No tenés tarjetas pendientes por ahora.", boton("Ir a Tarjetas", () => ir("tarjetas"), "suave", { "data-foco": "1" })),
      botonConIcono(panelEstadisticas ? "Ocultar estadísticas" : "Ver estadísticas", "grafico", () => { accion(() => { panelEstadisticas = !panelEstadisticas; }); }, "suave boton-estadisticas",
        { id: "ver-estadisticas", "aria-expanded": panelEstadisticas ? "true" : "false", "aria-controls": "panel-estadisticas" }),
      panelEstadisticas && await dibujarPanelEstadisticas(e),
      e.porArea.length > 0 && bloque("Tarjetas por área",
        h("ul", { class: "lista" }, ...e.porArea.map((a) => h("li", {}, h("span", {}, a.nombre), h("strong", {}, String(a.total)))))));
  }

  async function dibujarPanelEstadisticas(e: Estadisticas): Promise<Node> {
    const g = await datosGraficos(d.almacen, d.reloj);
    return h("section", { id: "panel-estadisticas", class: "panel-estadisticas", "aria-label": "Estadísticas" },
      h("h2", {}, "Estadísticas"),
      h("p", { class: "suave" }, `Pendientes hoy: ${e.pendientesHoy}. Repasadas hoy: ${e.repasadasHoy}. Racha: ${e.racha} ${e.racha === 1 ? "día" : "días"}.`),
      h("div", { class: "graficos" },
        graficoRepasosPorDia(doc, g.repasosPorDia),
        graficoRetencion(doc, g.retencion),
        graficoTarjetasPorArea(doc, g.porArea),
        graficoTareasPorSemana(doc, g.tareasPorSemana)));
  }

  /** Fila de tarea con su tilde de 44 px (marca o desmarca al instante), fecha, meta e insignia de repetición. */
  function filaTarea(t: Tarea, o: { fecha?: boolean; acciones?: Hijo[]; meta?: string | undefined }): Node {
    const hecha = t.estado === "hecha";
    const datos: Hijo[] = [
      (o.fecha || t.fecha) && h("span", { class: `dato${o.fecha ? " dato-atrasado" : ""}` }, t.fecha ? formatearFecha(t.fecha) : "sin fecha"),
      o.meta && h("span", { class: "dato dato-meta" }, o.meta),
      reglaValida(t.repeticion) && h("span", { class: "dato dato-repite repeticion" }, `↻ ${describirRepeticion(t.repeticion)}`),
    ];
    return h("li", { class: hecha ? "hecha" : "" },
      h("label", { class: "tilde" },
        h("input", {
          type: "checkbox", class: "casilla", checked: hecha, "aria-label": `${hecha ? "Desmarcar" : "Marcar como hecha"}: ${t.titulo}`,
          onclick: () => accion(async () => { await (hecha ? desmarcarHecha : marcarHecha)(d.almacen, d.reloj, t.id); }),
        }),
        h("span", { class: "fila-cuerpo" },
          h("span", { class: "texto" }, t.titulo),
          datos.some(Boolean) && h("span", { class: "fila-meta" }, ...datos))),
      t.nota && h("p", { class: "suave nota" }, t.nota),
      o.acciones && h("div", { class: "acciones" }, ...o.acciones));
  }

  // ---------- Repaso ----------
  /** Arranca una sesión nueva con ese filtro (null = todo lo de hoy). */
  function elegirFiltroRepaso(areaId: Id | null): void {
    accion(async () => { resumenRepaso = null; repaso = await PantallaRepaso.iniciar(d, { areaId }); });
  }

  /** Un chip del selector: texto + contador, `aria-pressed` si es el elegido. */
  function chip(id: string, texto: string, n: number, elegido: boolean, onclick: () => void, clase = ""): Node {
    return h("button", { type: "button", class: `chip ${clase}`.trim(), id, "aria-pressed": elegido ? "true" : "false", onclick: () => onclick() },
      texto, " ", h("span", { class: "chip-n" }, String(n)));
  }

  /** "Qué repasar": Todo lo de hoy + una por área; con un área elegida, segunda fila con "Toda el área" y sus subáreas. */
  function selectorRepaso(c: ContadoresDeRepaso, filtro: Id | null): Node {
    const raizElegida = filtro ? c.areas.find((a) => a.id === filtro || a.subareas.some((s) => s.id === filtro)) : undefined;
    const filas: Node[] = [
      h("div", { class: "chips chips-fila", role: "group", "aria-label": "Qué repasar" },
        chip("r-chip-todo", "Todo lo de hoy", c.todo, !raizElegida, () => elegirFiltroRepaso(null)),
        ...c.areas.map((a) => chip(`r-chip-${a.id}`, a.nombre, a.paraHoy, raizElegida?.id === a.id, () => elegirFiltroRepaso(a.id)))),
    ];
    if (raizElegida && raizElegida.subareas.length > 0) {
      filas.push(h("div", { class: "chips chips-fila chips-sub", role: "group", "aria-label": "Subárea" },
        h("span", { class: "chips-etiqueta", "aria-hidden": "true" }, "Subárea"),
        chip(`r-chip-todo-${raizElegida.id}`, "Toda el área", raizElegida.paraHoy, filtro === raizElegida.id, () => elegirFiltroRepaso(raizElegida.id), "chico"),
        ...raizElegida.subareas.map((s) => chip(`r-chip-${s.id}`, s.nombre, s.paraHoy, filtro === s.id, () => elegirFiltroRepaso(s.id), "chico"))));
    }
    return h("div", { class: "repaso-selector" }, ...filas);
  }

  /** Panel del resumen del tema: diálogo con foco, se cierra con Escape, con el botón o tocando afuera. No muestra respuestas. */
  function dialogoResumen(r: { tema: string; etiqueta: string; texto: string }): Node {
    const cerrar = () => accion(() => { resumenRepaso = null; focoEn = "r-ver-resumen"; });
    return h("div", { class: "resumen-fondo", id: "r-resumen-fondo", onclick: (ev: Event) => { if (ev.target === ev.currentTarget) cerrar(); } },
      h("div", { class: "resumen-dialogo", id: "r-resumen", role: "dialog", "aria-modal": "true", "aria-labelledby": "r-resumen-titulo", tabindex: "-1" },
        h("p", { class: "resumen-contexto" }, r.etiqueta),
        h("h2", { id: "r-resumen-titulo" }, r.tema ? `Resumen de ${r.tema}` : "Resumen del tema"),
        h("div", { class: "resumen-cuerpo", tabindex: "0", role: "region", "aria-labelledby": "r-resumen-titulo" }, renderizarMarkdown(doc, r.texto)),
        boton("Cerrar", cerrar, "principal", { id: "r-resumen-cerrar" })));
  }

  async function dibujarRepaso(): Promise<Node> {
    if (!repaso) repaso = await PantallaRepaso.iniciar(d);
    const v: VistaRepaso = await repaso.vista();
    const aj = cargarAjustes(d.persistencia);
    const selector = selectorRepaso(await contadoresDeRepaso(d.almacen, d.reloj, { limiteNuevas: aj.nuevasPorDia }), v.areaId);
    const deshacer = v.puedeDeshacer && boton("Deshacer (Ctrl+Z)", () => accion(() => repaso!.deshacer()), "suave chico");
    if (!v.hayTarjeta) {
      const donde = v.areaId ? (v.areaId && (await d.almacen.areas.obtener(v.areaId))?.padre_id ? "en esta subárea" : "en esta área") : "hoy";
      return h("section", { class: "repaso" }, selector,
        h("div", { class: "tarjeta-repaso repaso-vacio" },
          h("h1", { class: "pregunta" }, `No hay nada para repasar ${donde}`),
          h("p", { class: "suave" }, v.calificadas > 0 ? `Listo: repasaste ${v.calificadas} ${v.calificadas === 1 ? "tarjeta" : "tarjetas"}.` : "No hay tarjetas para repasar ahora."),
          v.proxima && h("p", { class: "repaso-proxima" }, `Lo próximo toca el ${formatearFecha(v.proxima)}.`),
          h("div", { class: "acciones acciones-centro" },
            boton("Ver áreas", () => ir("areas"), "principal", { "data-foco": "1" }),
            boton("Volver a Hoy", () => ir("hoy"), "suave"),
            deshacer)));
    }
    const pista = v.hayPista && (v.pista !== undefined
      ? h("p", { class: "pista" }, v.pista)
      : boton("Ver pista", () => accion(() => repaso!.verPista()), "suave chico"));
    const zonaRespuesta = v.respuestaVisible
      ? [
          h("div", { class: "respuesta", tabindex: "-1", "data-foco": "1" }, h("span", { class: "etiqueta" }, "Respuesta"), h("p", {}, v.respuesta)),
          h("div", { class: "calificacion" },
            h("p", { class: "calificacion-titulo", id: "r-calif-titulo" }, "¿Qué tan bien te acordabas?"),
            h("div", { class: "botones-respuesta", role: "group", "aria-labelledby": "r-calif-titulo" },
              ...v.botones!.map((b) =>
                h("button", { type: "button", class: `boton calificar calificar-${b.boton}`, onclick: () => calificar(b.boton) },
                  h("span", { class: "etiqueta-boton" }, b.etiqueta),
                  h("span", { class: "intervalo" }, b.intervalo),
                  h("kbd", {}, String(b.atajo))))))]
      : [boton("Ver respuesta", () => accion(() => repaso!.verRespuesta()), "grande principal", { "data-foco": "1" })];
    const textoTarjeta = `Tarjeta ${v.numero} de ${v.total}`;
    return h("section", { class: "repaso" }, selector,
      h("div", { class: "repaso-progreso" },
        h("div", { class: "repaso-progreso-texto" },
          h("span", { class: "repaso-numero" }, textoTarjeta),
          h("span", { class: "repaso-faltan" }, `Faltan ${v.faltan}`),
          deshacer),
        h("progress", { max: v.total!, value: v.calificadas, "aria-label": "Progreso del repaso", "aria-valuetext": textoTarjeta })),
      h("article", { class: "tarjeta-repaso" },
        h("div", { class: "tarjeta-cabeza" },
          h("span", { class: "contexto" }, v.etiqueta),
          v.hayResumen && h("button", {
            type: "button", class: "enlace-accion", id: "r-ver-resumen",
            onclick: () => accion(async () => { resumenRepaso = (await repaso!.resumenDelTema()) ?? null; focoEn = resumenRepaso ? "r-resumen" : null; }),
          }, "Ver el resumen del tema")),
        h("h1", { class: "pregunta" }, v.pregunta),
        pista,
        ...zonaRespuesta),
      h("p", { class: "atajos suave" }, "Atajos: espacio para mostrar la respuesta · 1 a 4 para calificar · Ctrl+Z deshace"),
      resumenRepaso && dialogoResumen(resumenRepaso));
  }
  function calificar(b: Calificacion): void { accion(() => repaso!.calificar(b)); }

  // ---------- Tareas y metas ----------
  function select(id: string, etiqueta: string, opciones: { id: string; nombre: string }[], valor: string, vacio?: string): HTMLElement {
    const sel = h("select", { id, "aria-label": etiqueta },
      ...(vacio !== undefined ? [h("option", { value: "" }, vacio)] : []),
      ...opciones.map((o) => h("option", { value: o.id }, o.nombre))) as HTMLSelectElement;
    sel.value = valor;
    return h("label", {}, etiqueta, sel);
  }

  async function dibujarTareas(): Promise<Node> {
    const v = await vistaTareas(d);
    const opcionesMeta = v.metas.map((m) => ({ id: m.meta.id, nombre: m.etiqueta }));
    const nombres = new Map(opcionesMeta.map((o) => [o.id, o.nombre]));
    const fila = (t: Tarea) => tareaEnForm === t.id
      ? formularioTarea(t, opcionesMeta)
      : filaTarea(t, {
          meta: t.meta_id ? nombres.get(t.meta_id) : undefined,
          acciones: [
            boton("Editar", () => accion(() => { tareaEnForm = t.id; }), "suave chico"),
            boton("Borrar", () => accion(async () => {
              await borrarTarea(d.almacen, d.reloj, t.id);
              if (tareaEnForm === t.id) tareaEnForm = null;
              aviso = "Tarea enviada a la papelera. Podés restaurarla desde “Ver papelera” en Tarjetas.";
            }), "peligro chico"),
          ],
        });
    const lista = (ts: Tarea[], vacio: string) => ts.length === 0 ? vacioConIcono("tareas", vacio) : h("ul", { class: "lista tareas" }, ...ts.map(fila));
    const pendientes = v.bandeja.length + v.conFecha.length;
    return h("section", { class: "pantalla-tareas" },
      encabezado("Tareas", pendientes === 0 ? "No tenés tareas pendientes." : `${plural(pendientes, "tarea pendiente", "tareas pendientes")}, y tus metas con su progreso.`, {
        accion: botonConIcono("Nueva tarea", "mas", () => accion(() => { tareaEnForm = tareaEnForm === "nueva" ? null : "nueva"; }), "principal grande-cta"),
      }),
      tareaEnForm === "nueva" && h("ul", { class: "lista" }, formularioTarea(null, opcionesMeta)),
      bloque("Bandeja (sin fecha)", lista(v.bandeja, "La bandeja está vacía.")),
      bloque("Con fecha", lista(v.conFecha, "No hay tareas pendientes con fecha.")),
      v.hechas.length > 0 && bloque("Hechas", lista(v.hechas, "")),
      h("section", { class: "bloque" },
        h("div", { class: "seccion-linea" },
          h("h2", {}, "Metas"),
          h("div", { class: "acciones" },
            botonConIcono("Nueva meta anual", "objetivo", () => accion(() => { formMeta = formMeta === "anual" ? null : "anual"; }), "suave"),
            botonConIcono("Nueva meta trimestral", "objetivo", () => accion(() => { formMeta = formMeta === "trimestral" ? null : "trimestral"; }), "suave"))),
        formMeta && formularioMeta(formMeta, v.metas.filter((m) => m.meta.tipo === "anual")),
        v.metas.length === 0 ? vacioConIcono("objetivo", "Todavía no hay metas.") : h("ul", { class: "lista metas" }, ...v.metas.map(filaMeta))));
  }

  function formularioTarea(t: Tarea | null, opcionesMeta: { id: Id; nombre: string }[]): Node {
    const titulo = h("input", { type: "text", id: "tarea-titulo", "aria-label": "Título", value: previo("tarea-titulo", t?.titulo ?? ""), "data-foco": "1" }) as HTMLInputElement;
    const fecha = h("input", { type: "date", id: "tarea-fecha", "aria-label": "Fecha", value: previo("tarea-fecha", t?.fecha ?? "") }) as HTMLInputElement;
    const nota = h("textarea", { id: "tarea-nota", rows: 2, "aria-label": "Nota" }, previo("tarea-nota", t?.nota ?? "")) as HTMLTextAreaElement;
    const metaLabel = select("tarea-meta", "Meta", opcionesMeta, previo("tarea-meta", t?.meta_id ?? ""), "Sin meta");
    const rep = reglaValida(t?.repeticion);
    const tipoRep = h("select", { id: "tarea-repetir", "aria-label": "Repetir" },
      h("option", { value: "no" }, "No"), h("option", { value: "diaria" }, "Todos los días"),
      h("option", { value: "semanal" }, "Ciertos días de la semana"), h("option", { value: "mensual" }, "Un día del mes")) as HTMLSelectElement;
    tipoRep.value = previo("tarea-repetir", rep?.tipo ?? "no");
    const NOMBRES_DIAS = ["L", "M", "X", "J", "V", "S", "D"];
    const casillas = NOMBRES_DIAS.map((n, i) => {
      const c = h("input", { type: "checkbox", id: `tarea-repetir-dia-${i + 1}`, "aria-label": ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][i]! }) as HTMLInputElement;
      c.checked = previo(c.id, rep?.tipo === "semanal" && rep.dias.includes(i + 1) ? "1" : "") === "1";
      return h("label", { class: "chip-dia" }, c, h("span", { class: "opcion" }, n));
    });
    const diaMes = h("input", {
      type: "number", id: "tarea-repetir-dia-mes", "aria-label": "Día del mes", min: 1, max: 31,
      value: previo("tarea-repetir-dia-mes", rep?.tipo === "mensual" ? String(rep.dia_mes) : ""),
    }) as HTMLInputElement;
    const reglaDelForm = (): Repeticion | null => {
      if (tipoRep.value === "diaria") return { tipo: "diaria" };
      if (tipoRep.value === "semanal") {
        return { tipo: "semanal", dias: casillas.map((l, i) => (l.querySelector("input")!.checked ? i + 1 : 0)).filter((n) => n > 0) };
      }
      if (tipoRep.value === "mensual") return { tipo: "mensual", dia_mes: Number(diaMes.value) };
      return null;
    };
    const guardar = () => accion(async () => {
      recordar(titulo, fecha, nota, metaLabel.querySelector("select"));
      const datos = {
        titulo: titulo.value, fecha: fecha.value || null,
        meta_id: (metaLabel.querySelector("select") as HTMLSelectElement).value || null, nota: nota.value.trim() || null,
        repeticion: reglaDelForm(),
      };
      if (t) await editarTarea(d.almacen, d.reloj, t.id, datos);
      else await crearTarea(d.almacen, d.reloj, datos);
      tareaEnForm = null;
      aviso = t ? "Cambios guardados." : "Tarea guardada.";
    });
    const detalleRep = h("div", { class: "repeticion-detalle" },
      tipoRep.value === "semanal" ? h("div", { role: "group", "aria-label": "Días de la semana", class: "dias-semana" }, ...casillas) : null,
      tipoRep.value === "mensual" ? h("label", {}, "Día del mes (1 a 31)", diaMes) : null);
    const form = recordando(h("li", { class: "edicion" },
      h("label", {}, "Título", titulo), h("label", {}, "Fecha (opcional)", fecha), metaLabel, h("label", {}, "Nota (opcional)", nota),
      h("label", {}, "Repetir", tipoRep), detalleRep,
      h("div", { class: "acciones" },
        boton("Guardar tarea", guardar, "principal chico"),
        rep && t ? boton("Dejar de repetir", () => accion(async () => {
          await detenerRepeticion(d.almacen, d.reloj, t.id);
          tareaEnForm = null;
          aviso = "Listo: la tarea ya no se repite.";
        }), "suave chico") : null,
        boton("Cancelar", () => accion(() => { tareaEnForm = null; }), "suave chico"))));
    // Las casillas guardan "1" o "" (no el value fijo de la casilla); se registran después de recordando.
    for (const l of casillas) {
      const c = l.querySelector("input")!;
      c.addEventListener("change", () => recuerdo.set(c.id, c.checked ? "1" : ""));
    }
    // Al cambiar el tipo se redibuja para mostrar los campos que corresponden.
    tipoRep.addEventListener("change", () => accion(() => { recordar(tipoRep); }));
    return form;
  }

  function formularioMeta(tipo: "anual" | "trimestral", anuales: MetaConProgreso[]): Node {
    const hoy = diaLogico(d.reloj);
    const anio = h("input", { type: "number", id: "meta-anio", "aria-label": "Año", value: previo("meta-anio", hoy.slice(0, 4)), min: 2000, max: 2200 }) as HTMLInputElement;
    const titulo = h("input", { type: "text", id: "meta-titulo", "aria-label": "Título", value: previo("meta-titulo", ""), "data-foco": "1" }) as HTMLInputElement;
    const trimestre = select("meta-trimestre", "Trimestre", [1, 2, 3, 4].map((n) => ({ id: String(n), nombre: `T${n}` })), previo("meta-trimestre", String(Math.ceil(Number(hoy.slice(5, 7)) / 3))));
    const padre = select("meta-padre", "Cuelga de la meta anual (opcional)", anuales.map((m) => ({ id: m.meta.id, nombre: m.etiqueta })), previo("meta-padre", ""), "Ninguna");
    const valor = (l: HTMLElement) => (l.querySelector("select") as HTMLSelectElement).value;
    return recordando(h("div", { class: "edicion" },
      h("label", {}, "Año", anio), h("label", {}, "Título", titulo),
      tipo === "trimestral" && trimestre, tipo === "trimestral" && padre,
      h("div", { class: "acciones" },
        boton("Guardar meta", () => accion(async () => {
          recordar(anio, titulo, trimestre.querySelector("select"), padre.querySelector("select"));
          const datos = { anio: Number(anio.value), titulo: titulo.value };
          if (tipo === "anual") await crearMetaAnual(d.almacen, d.reloj, datos);
          else await crearMetaTrimestral(d.almacen, d.reloj, { ...datos, trimestre: Number(valor(trimestre)) as Trimestre, padre_id: valor(padre) || null });
          formMeta = null;
          aviso = "Meta guardada.";
        }), "principal chico"),
        boton("Cancelar", () => accion(() => { formMeta = null; }), "suave chico"))));
  }

  function filaMeta(m: MetaConProgreso): Node {
    const estado = h("select", { "aria-label": `Estado de la meta ${m.meta.titulo}`, class: "estado-meta" },
      ...ESTADOS_META.map((e) => h("option", { value: e.id }, e.nombre))) as HTMLSelectElement;
    estado.value = m.meta.estado;
    estado.addEventListener("change", () => accion(async () => { await cambiarEstadoMeta(d.almacen, d.reloj, m.meta.id, estado.value as EstadoMeta); }));
    return h("li", { class: `meta meta-${m.meta.estado}` },
      h("div", { class: "texto" },
        h("div", { class: "meta-titulo" }, h("strong", {}, m.etiqueta), h("span", { class: "dato" }, m.meta.tipo === "anual" ? "anual" : "trimestral")),
        h("div", { class: "progreso" }, h("progress", { max: 100, value: m.progreso.porcentaje, "aria-label": "Progreso" }), h("span", { class: "suave" }, textoProgreso(m.progreso)))),
      h("div", { class: "acciones" }, estado,
        boton("Borrar meta", () => accion(async () => {
          await borrarMeta(d.almacen, d.reloj, m.meta.id);
          aviso = "Meta enviada a la papelera. Sus tareas quedaron sin meta.";
        }), "peligro chico")));
  }

  // ---------- Apuntes ----------
  async function dibujarApuntes(): Promise<Node> {
    const f: FiltrosApuntes = { texto: filtros.texto };
    if (filtros.tipo) f.tipo = filtros.tipo as TipoApunte;
    if (filtros.etiqueta) f.etiqueta = filtros.etiqueta;
    if (filtros.area) f.area_id = filtros.area;
    const v = await vistaApuntes(d, f);
    const filtrando = !!(filtros.texto || filtros.tipo || filtros.etiqueta || filtros.area);
    const buscador = h("input", {
      type: "search", id: "busqueda-apuntes", class: "campo-pastilla", placeholder: "Buscar en los apuntes", value: filtros.texto, "aria-label": "Buscar apuntes",
      oninput: (ev: Event) => { filtros.texto = (ev.target as HTMLInputElement).value; accion(() => undefined); },
    });
    const filtro = (id: string, clave: "tipo" | "etiqueta" | "area", etiqueta: string, ops: { id: string; nombre: string }[], todos: string) => {
      const l = select(id, etiqueta, ops, filtros[clave], todos);
      l.querySelector("select")!.addEventListener("change", (ev) => { filtros[clave] = (ev.target as HTMLSelectElement).value; accion(() => undefined); });
      return l;
    };
    return h("section", { class: "pantalla-apuntes" },
      encabezado("Apuntes", "Capturá ideas y apuntes en el momento; después buscalos, editalos o pasalos a tarea o tarjeta.", {
        accion: botonConIcono("Nuevo apunte", "mas", () => accion(() => { capturaAbierta = !capturaAbierta; }), "principal grande-cta", { title: "Atajo: tecla n" }),
      }),
      capturaAbierta && dibujarCaptura(),
      borradorTarjeta && formularioTarjeta(borradorTarjeta.b, v.areas),
      h("div", { class: "barra-busqueda" },
        conLupa(buscador),
        h("div", { class: "filtros" },
          filtro("filtro-tipo", "tipo", "Tipo", TIPOS_APUNTE.map((t) => ({ id: t, nombre: TIPOS_NOMBRE[t] })), "Todos"),
          filtro("filtro-etiqueta", "etiqueta", "Etiqueta", v.etiquetas.map((e) => ({ id: e, nombre: e })), "Todas"),
          filtro("filtro-area", "area", "Área", v.areas, "Todas"))),
      v.apuntes.length === 0
        ? vacioConIcono("apuntes", filtrando ? "No hay apuntes que coincidan con la búsqueda." : "Todavía no hay apuntes. Tocá “Nuevo apunte” (o la tecla n) y escribí.")
        : h("ul", { class: "lista apuntes" }, ...v.apuntes.map((a) => (apunteEnEdicion === a.id ? formularioApunte(a, v.areas) : filaApunte(a, v.areas)))));
  }

  let textoCaptura = "";
  function dibujarCaptura(): Node {
    const caja = h("textarea", {
      id: "captura-texto", rows: 4, "aria-label": "Texto del apunte", placeholder: "Escribí tu idea o apunte (Markdown simple). Ctrl+Enter para guardar.", "data-foco": "1",
      oninput: (ev: Event) => { textoCaptura = (ev.target as HTMLTextAreaElement).value; },
    }) as HTMLTextAreaElement;
    caja.value = textoCaptura;
    const guardar = () => accion(async () => {
      textoCaptura = caja.value;
      await crearApunte(d.almacen, d.reloj, { texto: textoCaptura });
      textoCaptura = "";
      capturaAbierta = false;
      aviso = "Apunte guardado.";
    });
    caja.addEventListener("keydown", (ev) => {
      const ke = ev as KeyboardEvent;
      if (ke.key === "Enter" && (ke.ctrlKey || ke.metaKey)) { ke.preventDefault(); guardar(); }
    });
    return h("div", { class: "captura panel" }, caja,
      h("div", { class: "acciones" },
        boton("Guardar apunte", guardar, "principal"),
        ...botonesAudio(),
        boton("Cancelar", () => accion(() => { grabadora?.detener(true); capturaAbierta = false; }), "suave")),
      textoEstadoAudio());
  }

  // ---------- entrada por audio (opcional, O7-O12) ----------
  const TOPE_GRABACION_MS = 120_000;
  const TOPE_AUDIO_BYTES = 10 * 1024 * 1024;

  /** Consulta si el audio está activo y configurado (solo con sesión). Sin conexión o error: se conserva el último estado conocido. */
  async function cargarAudio(): Promise<void> {
    const s = d.sync;
    errorAudioAjustes = "";
    if (!s || !s.pedirConSesion || !s.hayCuenta()) return;
    try {
      const r = await s.pedirConSesion("/ajustes/audio");
      if (!r.ok) throw new Error("estado");
      audioEstado = (await r.json()) as EstadoAudio;
      audioSinConexion = false;
    } catch (e) {
      audioSinConexion = (e as { tipo?: string }).tipo === "sin_conexion";
      errorAudioAjustes = "No se pudo consultar el estado de la entrada por audio (¿sin conexión?).";
    }
  }

  /** Por qué el micrófono no se puede usar ahora; "" si se puede; null si no corresponde mostrarlo (desactivado o desconocido). */
  function motivoAudio(): string | null {
    const s = d.sync;
    if (!s || !s.pedirConSesion || !audioEstado || !audioEstado.activo) return null;
    if (!s.hayCuenta()) return "Iniciá sesión para usar el micrófono.";
    if (audioSinConexion || (doc.defaultView?.navigator as Navigator | undefined)?.onLine === false) return "Sin conexión: el micrófono necesita internet.";
    if (!audioEstado.configurado) return "Falta configurar la entrada por audio en el servidor.";
    return "";
  }

  function botonesAudio(): Node[] {
    const motivo = motivoAudio();
    if (motivo === null) return [];
    if (faseAudio === "grabando") return [boton("Parar", () => grabadora?.detener(false), "chico", { id: "captura-parar" })];
    const ocupado = faseAudio !== "";
    return [botonConIcono("Micrófono", "microfono", () => { void grabar(); }, "suave chico", { id: "captura-mic", ...(motivo !== "" || ocupado ? { disabled: true } : {}) })];
  }

  function textoEstadoAudio(): Node | null {
    const motivo = motivoAudio();
    if (motivo === null) return null;
    const texto = faseAudio === "pidiendo" ? "Esperando permiso del micrófono…"
      : faseAudio === "grabando" ? "Grabando… tocá Parar cuando termines (máximo 2 minutos)."
      : faseAudio === "transcribiendo" ? "Transcribiendo…"
      : mensajeAudio || motivo;
    if (!texto) return null;
    return h("p", { id: "audio-estado", class: mensajeAudio && faseAudio === "" ? "aviso" : "suave", role: "status" }, texto);
  }

  function agregarACaptura(texto: string): void {
    const t = texto.trim();
    if (!t) return;
    textoCaptura = textoCaptura === "" ? t : `${textoCaptura}${/\s$/.test(textoCaptura) ? "" : "\n"}${t}`;
  }

  async function transcribir(audio: Blob, tipo: string): Promise<void> {
    faseAudio = "transcribiendo";
    redibujar();
    try {
      const r = await d.sync!.pedirConSesion!("/audio/transcribir", { method: "POST", headers: { "content-type": tipo }, body: audio });
      if (!r.ok) {
        let msg = "No se pudo transcribir el audio. Podés escribir el apunte.";
        try { const j = (await r.json()) as { error?: unknown }; if (typeof j.error === "string") msg = j.error; } catch { /* mensaje genérico */ }
        mensajeAudio = msg;
      } else {
        const j = (await r.json()) as { texto?: unknown };
        agregarACaptura(typeof j.texto === "string" ? j.texto : "");
        mensajeAudio = "";
      }
    } catch (e) {
      const tipoError = (e as { tipo?: string }).tipo;
      mensajeAudio = tipoError === "sesion" ? "Iniciá sesión para usar el micrófono."
        : tipoError === "sin_conexion" ? "Sin conexión: no se pudo transcribir. Lo escrito sigue acá."
        : "No se pudo transcribir el audio. Podés escribir el apunte.";
    }
    faseAudio = "";
    redibujar();
  }

  async function grabar(): Promise<void> {
    if (faseAudio !== "") return;
    mensajeAudio = "";
    const win = doc.defaultView as unknown as { navigator?: Navigator; MediaRecorder?: typeof MediaRecorder } | null;
    const getUserMedia = win?.navigator?.mediaDevices?.getUserMedia?.bind(win.navigator.mediaDevices);
    const Grabadora = win?.MediaRecorder;
    if (!getUserMedia || !Grabadora) {
      mensajeAudio = "Este navegador no permite grabar audio. Podés seguir escribiendo el apunte.";
      redibujar();
      return;
    }
    faseAudio = "pidiendo";
    redibujar();
    let flujo: MediaStream;
    try {
      flujo = await getUserMedia({ audio: true });
    } catch {
      faseAudio = "";
      mensajeAudio = "No se pudo usar el micrófono (¿negaste el permiso?). Podés seguir escribiendo el apunte.";
      redibujar();
      return;
    }
    const trozos: Blob[] = [];
    let bytes = 0;
    let descartar = false;
    let excedido = false;
    let rec: MediaRecorder;
    try {
      rec = new Grabadora(flujo);
    } catch {
      flujo.getTracks().forEach((t) => t.stop());
      faseAudio = "";
      mensajeAudio = "Este navegador no permite grabar audio. Podés seguir escribiendo el apunte.";
      redibujar();
      return;
    }
    const temporizador = setTimeout(() => detener(false), TOPE_GRABACION_MS);
    function detener(descarta: boolean): void {
      if (descarta) descartar = true;
      clearTimeout(temporizador);
      if (rec.state !== "inactive") rec.stop();
    }
    rec.addEventListener("dataavailable", (ev) => {
      const b = (ev as BlobEvent).data;
      if (!b || b.size === 0) return;
      bytes += b.size;
      if (bytes > TOPE_AUDIO_BYTES) { excedido = true; detener(false); return; }
      trozos.push(b);
    });
    rec.addEventListener("stop", () => {
      clearTimeout(temporizador);
      flujo.getTracks().forEach((t) => t.stop());
      grabadora = null;
      if (descartar) { faseAudio = ""; mensajeAudio = ""; redibujar(); return; }
      if (excedido) { faseAudio = ""; mensajeAudio = "La grabación es demasiado larga (máximo 10 MB). Probá con algo más corto."; redibujar(); return; }
      if (trozos.length === 0) { faseAudio = ""; mensajeAudio = "No se grabó nada. Probá de nuevo."; redibujar(); return; }
      const tipo = ((rec.mimeType || trozos[0]!.type || "audio/webm").split(";")[0] as string).trim() || "audio/webm";
      void transcribir(new Blob(trozos, { type: tipo }), tipo);
    });
    grabadora = { detener };
    try {
      rec.start(1000);
    } catch {
      grabadora = null;
      clearTimeout(temporizador);
      flujo.getTracks().forEach((t) => t.stop());
      faseAudio = "";
      mensajeAudio = "No se pudo empezar a grabar. Podés seguir escribiendo el apunte.";
      redibujar();
      return;
    }
    faseAudio = "grabando";
    redibujar();
  }

  function filaApunte(a: Apunte, areas: { id: Id; nombre: string }[]): Node {
    const area = a.area_id ? areas.find((x) => x.id === a.area_id)?.nombre : undefined;
    return h("li", { class: "apunte" },
      h("div", { class: "texto" },
        h("div", { class: "apunte-cabeza" },
          h("span", { class: `insignia-estado tipo-${a.tipo}` }, TIPOS_NOMBRE[a.tipo]),
          h("strong", { class: "apunte-titulo" }, tituloApunte(a))),
        h("div", { class: "suave apunte-datos" }, [area, formatearFecha(diaDe(a.created_at))].filter(Boolean).join(" · ")),
        a.etiquetas.length > 0 && h("ul", { class: "etiquetas-sub", "aria-label": "Etiquetas" }, ...a.etiquetas.map((e) => h("li", {}, `#${e}`))),
        renderizarMarkdown(doc, a.texto)),
      h("div", { class: "acciones" },
        boton("Editar", () => accion(() => { apunteEnEdicion = a.id; }), "suave chico"),
        boton("Pasar a tarea", () => accion(async () => {
          await convertirApunteATarea(d.almacen, d.reloj, a.id);
          aviso = "Tarea creada a partir del apunte. La encontrás en la bandeja de Tareas.";
        }), "suave chico"),
        boton("Pasar a tarjeta", () => accion(async () => { borradorTarjeta = { apunteId: a.id, b: await convertirApunteATarjeta(d.almacen, a.id) }; }), "suave chico"),
        boton("Borrar", () => accion(async () => {
          await borrarApunte(d.almacen, d.reloj, a.id);
          if (apunteEnEdicion === a.id) apunteEnEdicion = null;
          if (borradorTarjeta?.apunteId === a.id) borradorTarjeta = null;
          aviso = "Apunte enviado a la papelera. Podés restaurarlo desde “Ver papelera” en Tarjetas.";
        }), "peligro chico")));
  }
  /** Fecha local (día lógico del instante guardado) para mostrar. */
  const diaDe = (instante: string): string => diaLogico({ ahora: () => new Date(instante) });

  function formularioApunte(a: Apunte, areas: { id: Id; nombre: string }[]): Node {
    const titulo = h("input", { type: "text", id: "apunte-titulo", "aria-label": "Título", value: previo("apunte-titulo", a.titulo ?? ""), placeholder: "Opcional" }) as HTMLInputElement;
    const texto = h("textarea", { id: "apunte-texto", rows: 6, "aria-label": "Texto", "data-foco": "1" }, previo("apunte-texto", a.texto)) as HTMLTextAreaElement;
    const etiquetas = h("input", { type: "text", id: "apunte-etiquetas", "aria-label": "Etiquetas", value: previo("apunte-etiquetas", a.etiquetas.join(", ")), placeholder: "Separadas por coma" }) as HTMLInputElement;
    const tipo = select("apunte-tipo", "Tipo", TIPOS_APUNTE.map((t) => ({ id: t, nombre: TIPOS_NOMBRE[t] })), previo("apunte-tipo", a.tipo));
    const area = select("apunte-area", "Área (opcional)", areas, previo("apunte-area", a.area_id ?? ""), "Sin área");
    const valor = (l: HTMLElement) => (l.querySelector("select") as HTMLSelectElement).value;
    return recordando(h("li", { class: "edicion" },
      h("label", {}, "Título (opcional)", titulo), h("label", {}, "Texto", texto), h("label", {}, "Etiquetas", etiquetas), tipo, area,
      h("div", { class: "acciones" },
        boton("Guardar apunte", () => accion(async () => {
          recordar(titulo, texto, etiquetas, tipo.querySelector("select"), area.querySelector("select"));
          await editarApunte(d.almacen, d.reloj, a.id, {
            titulo: titulo.value, texto: texto.value, tipo: valor(tipo) as TipoApunte, etiquetas: separarEtiquetas(etiquetas.value), area_id: valor(area) || null,
          });
          apunteEnEdicion = null;
          aviso = "Cambios guardados.";
        }), "principal chico"),
        boton("Cancelar", () => accion(() => { apunteEnEdicion = null; }), "suave chico"))));
  }

  /** Formulario de tarjeta con el texto del apunte precargado; guardar crea la tarjeta. */
  function formularioTarjeta(b: BorradorTarjeta, areas: { id: Id; nombre: string }[]): Node {
    const pregunta = h("textarea", { id: "tarjeta-pregunta", rows: 2, "aria-label": "Pregunta", "data-foco": "1" }, previo("tarjeta-pregunta", b.pregunta)) as HTMLTextAreaElement;
    const respuesta = h("textarea", { id: "tarjeta-respuesta", rows: 4, "aria-label": "Respuesta" }, previo("tarjeta-respuesta", b.respuesta)) as HTMLTextAreaElement;
    const pista = h("input", { type: "text", id: "tarjeta-pista", "aria-label": "Pista", value: previo("tarjeta-pista", b.pista ?? "") }) as HTMLInputElement;
    const area = select("tarjeta-area", "Área", areas, previo("tarjeta-area", b.area_id ?? ""), "Elegí un área");
    const nueva = h("input", { type: "text", id: "tarjeta-area-nueva", "aria-label": "Área nueva", value: previo("tarjeta-area-nueva", ""), placeholder: "Por ejemplo: Programación > CS50" }) as HTMLInputElement;
    return recordando(h("div", { class: "edicion panel" },
      h("h2", {}, "Nueva tarjeta desde el apunte"),
      h("label", {}, "Pregunta", pregunta), h("label", {}, "Respuesta", respuesta), h("label", {}, "Pista (opcional)", pista), area,
      h("label", {}, "O escribí un área nueva (opcional)", nueva),
      h("div", { class: "acciones" },
        boton("Guardar tarjeta", () => accion(async () => {
          recordar(pregunta, respuesta, pista, area.querySelector("select"), nueva);
          await crearTarjeta(d.almacen, d.reloj, {
            pregunta: pregunta.value, respuesta: respuesta.value, pista: pista.value,
            area_id: (area.querySelector("select") as HTMLSelectElement).value || null, area_texto: nueva.value,
          });
          borradorTarjeta = null;
          aviso = "Tarjeta creada. La vas a ver en el repaso.";
        }), "principal chico"),
        boton("Cancelar", () => accion(() => { borradorTarjeta = null; }), "suave chico"))));
  }

  // ---------- Tarjetas ----------
  async function dibujarTarjetas(): Promise<Node> {
    const buscador = h("input", {
      type: "search", id: "busqueda", class: "campo-pastilla", placeholder: "Buscar en las tarjetas", value: busqueda, "aria-label": "Buscar tarjetas",
      oninput: (ev: Event) => { busqueda = (ev.target as HTMLInputElement).value; accion(() => undefined); },
    });
    const enPapelera = await itemsPapelera(d);
    const partes: Hijo[] = [
      encabezado("Tarjetas", "Buscá, editá, suspendé o borrá tus tarjetas, agrupadas por área.", {
        accion: botonConIcono(importAbierto ? "Cerrar importación" : "Importar", "mas", () => accion(() => {
          importAbierto = !importAbierto;
          limpiarResultadosImportar();
          textoImport = ""; // abrir o cerrar la caja empieza de cero: nada de la vez anterior
        }), "principal grande-cta"),
      }),
      h("div", { class: "barra" },
        boton("Deshacer última importación", () => accion(async () => {
          const r = await deshacerUltimaImportacion(d.almacen, d.reloj);
          limpiarResultadosImportar();
          aviso = r ? `Se deshizo la última importación: ${r.tarjetas} ${r.tarjetas === 1 ? "tarjeta pasó" : "tarjetas pasaron"} a la papelera.` : "No hay ninguna importación para deshacer.";
        }), "suave"),
        botonConIcono(`${papelera ? "Ocultar" : "Ver"} papelera (${enPapelera.length})`, "papelera", () => accion(() => { papelera = !papelera; }), "suave")),
      importAbierto && await dibujarImportar(),
      conLupa(buscador),
    ];
    if (papelera) {
      partes.push(bloque("Papelera", enPapelera.length === 0
        ? vacioConIcono("papelera", "La papelera está vacía.")
        : h("ul", { class: "lista papelera" }, ...enPapelera.map((i) => h("li", {},
            h("span", { class: "texto" }, h("em", {}, `${nombreTipoPapelera(i.tipo)}: `), i.titulo, i.detalle && h("span", { class: "suave" }, ` (${i.detalle})`)),
            boton("Restaurar", () => accion(async () => { aviso = await restaurarItem(d, i.tipo, i.id); }), "suave chico")))),
        h("p", { class: "suave" }, "Lo que está en la papelera se elimina a los 30 días.")));
    }
    const grupos = await agruparTarjetas(d.almacen, busqueda);
    const opciones = await opcionesDeArea(d.almacen);
    if (grupos.length === 0) {
      partes.push(vacioConIcono("repaso", busqueda ? "No hay tarjetas que coincidan con la búsqueda." : "Todavía no hay tarjetas. Tocá “Importar” y pegá el JSON."));
    }
    for (const g of grupos) {
      partes.push(h("section", { class: "grupo-tarjetas" },
        h("div", { class: "grupo-cabeza" }, h("h2", { class: "grupo" }, g.nombre), h("span", { class: "insignia-estado estado-nuevo" }, plural(g.tarjetas.length, "tarjeta", "tarjetas"))),
        h("ul", { class: "lista tarjetas" }, ...g.tarjetas.map((t) => (editando === t.id ? formularioEdicion(t, opciones) : filaTarjeta(t))))));
    }
    return h("section", { class: "pantalla-tarjetas" }, ...partes);
  }

  /** Tarjeta de vista previa de un bloque (qué pasaría al confirmar). */
  function bloquePrevio(b: BloqueRevisado): Node {
    return h("article", { class: "bloque-previo" },
      h("div", { class: "bloque-previo-cabeza" },
        h("span", { class: "contexto" }, b.etiquetaArea),
        h("span", { class: "suave" }, formatearFecha(b.fecha))),
      h("h3", {}, b.tema),
      h("p", { class: "bloque-previo-cuenta" },
        h("strong", {}, plural(b.preguntas.length, "pregunta", "preguntas")), `: ${plural(b.nuevas, "nueva", "nuevas")}, ${plural(b.duplicadas, "duplicada", "duplicadas")}.`),
      b.yaImportado && h("p", { class: "aviso", role: "status" }, "Este bloque ya estaba importado: no hay nada nuevo para crear."),
      b.avisos.length > 0 && h("ul", { class: "avisos" }, ...b.avisos.map((a) => h("li", {}, a))),
      b.resumen && h("div", { class: "bloque-previo-resumen" }, h("span", { class: "etiqueta" }, "Resumen"), renderizarMarkdown(doc, b.resumen)),
      h("ul", { class: "preguntas-previas", "aria-label": `Preguntas de ${b.tema}` },
        ...b.preguntas.map((q) => h("li", { class: q.estado === "nueva" ? "nueva" : "duplicada" },
          h("span", { class: "pregunta-previa" }, q.p),
          h("span", { class: `insignia-estado ${q.estado === "nueva" ? "estado-hoy" : "estado-aldia"}` }, q.estado === "nueva" ? "Nueva" : "Duplicada")))));
  }

  async function dibujarImportar(): Promise<Node> {
    const raices = (await d.almacen.areas.listar()).filter((a) => a.padre_id === null).map((a) => a.nombre).sort((x, y) => x.localeCompare(y, "es"));
    const zona = h("div", { class: "importar-zona" });
    const caja = h("textarea", {
      id: "caja-importar", rows: 8, placeholder: "Pegá acá el JSON que generó Claude", "aria-label": "JSON para importar", spellcheck: "false",
      oninput: (ev: Event) => {
        textoImport = (ev.target as HTMLTextAreaElement).value;
        // Cambió el texto: la vista previa, el informe y el recordatorio ya no corresponden. Se quitan sin redibujar (no se pierde el cursor).
        if (informe || revision || recordatorioImport) { limpiarResultadosImportar(); zona.replaceChildren(); }
      },
    });
    (caja as HTMLTextAreaElement).value = textoImport;
    const revisar = () => accion(async () => {
      limpiarResultadosImportar();
      if (textoImport.trim() === "") { recordatorioImport = "Pegá primero el JSON que generó Claude."; focoEn = "caja-importar"; return; }
      revision = await revisarImportacion(d.almacen, d.reloj, textoImport);
      focoEn = revision.bloques.length > 0 ? "importar-previa" : "importar-errores"; // el foco va al principio de lo nuevo, no al final
    });
    const confirmar = () => accion(async () => {
      const r = await importar(d.almacen, d.reloj, textoImport);
      limpiarResultadosImportar();
      informe = r;
      // Si hubo errores el texto queda en la caja para corregirlo; si no, se limpia.
      textoImport = r.errores.length > 0 ? r.texto_original : "";
      focoEn = "importar-informe"; // el informe queda a la vista
    });
    const cancelar = () => accion(() => { limpiarResultadosImportar(); focoEn = "caja-importar"; });
    const partes: Hijo[] = [];
    if (recordatorioImport) partes.push(h("p", { class: "recordatorio", role: "status" }, recordatorioImport));
    if (revision) {
      const rv = revision;
      if (rv.errores.length > 0) {
        partes.push(h("div", { class: "informe", role: "alert", id: "importar-errores", tabindex: "-1" },
          h("p", {}, h("strong", {}, rv.bloques.length > 0 ? "Hay partes del texto que no pude leer:" : "No pude leer el texto. Corregilo y probá de nuevo:")),
          h("ul", { class: "errores" }, ...rv.errores.map((e) => h("li", {}, e)))));
      }
      if (rv.bloques.length > 0) {
        partes.push(h("div", { class: "vista-previa", role: "region", "aria-label": "Vista previa de la importación", id: "importar-previa", tabindex: "-1" },
          h("p", { class: "vista-previa-total" }, h("strong", {}, "Esto es lo que pasaría: "), `${plural(rv.nuevas, "tarjeta nueva", "tarjetas nuevas")} y ${plural(rv.duplicadas, "duplicada omitida", "duplicadas omitidas")}. Todavía no se creó nada.`),
          ...rv.bloques.map(bloquePrevio)));
        partes.push(h("div", { class: "acciones" },
          rv.puedeConfirmar && boton("Confirmar importación", confirmar, "principal", { id: "importar-confirmar" }),
          boton("Cancelar", cancelar, "suave", { id: "importar-cancelar" })));
        if (!rv.puedeConfirmar) partes.push(h("p", { class: "suave" }, "No hay nada nuevo para importar."));
      }
    }
    if (informe) {
      partes.push(h("div", { class: "informe", role: "status", id: "importar-informe", tabindex: "-1" },
        h("p", {}, h("strong", {}, `Creadas: ${informe.creadas}`), ` · Duplicadas omitidas: ${informe.duplicadas} · Errores: ${informe.errores.length}`),
        informe.errores.length > 0 && h("ul", { class: "errores" }, ...informe.errores.map((e) => h("li", {}, e))),
        informe.avisos.length > 0 && h("ul", { class: "avisos" }, ...informe.avisos.map((a) => h("li", {}, a)))));
    }
    zona.append(...partes.filter((x): x is Node => !!x));
    return h("div", { class: "importar" },
      raices.length > 0 && h("p", { class: "suave ayuda-areas" }, h("strong", {}, "Tus áreas: "), `${raices.join(", ")}.`),
      caja,
      h("div", { class: "acciones" }, boton("Revisar", revisar, "principal", { id: "importar-revisar" })),
      zona);
  }

  function filaTarjeta(t: Tarjeta): Node {
    return h("li", { class: t.suspendida ? "suspendida" : "" },
      h("div", { class: "texto" }, h("span", { class: "tarjeta-pregunta" }, t.pregunta),
        h("span", { class: "fila-meta" },
          t.suspendida && h("em", { class: "insignia-estado estado-aviso" }, "(suspendida)"),
          h("span", { class: "dato" }, `vence ${formatearFecha(t.vence)}`))),
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
    return h("section", { class: "pantalla-ajustes" },
      encabezado("Ajustes", "Cómo estudiás, cómo se ve la app y dónde viven tus datos. Los cambios se guardan solos."),
      h("div", { class: "ajustes-grilla" },
        h("section", { class: "panel ajuste" },
          h("h2", {}, "Estudio"),
          h("p", { class: "suave" }, "A esa hora empieza el día nuevo para el repaso. Los cambios se guardan solos."),
          h("div", { class: "campos-dos" },
            h("label", {}, "Tarjetas nuevas por día", nuevas),
            h("label", {}, "Hora de cambio de día", hora)),
          errorAjustes && h("p", { class: "aviso", role: "alert" }, errorAjustes)),
        dibujarTema(),
        d.sync && dibujarCuenta(d.sync),
        dibujarRespaldo(),
        dibujarMigracion(),
        (d.sync) && h("p", { class: "etiqueta grupo-opcional" }, "Opcionales"),
        d.sync && dibujarExterno(d.sync),
        d.sync && dibujarAudioAjustes(d.sync)));
  }

  const NOMBRE_TEMA: Record<Tema, string> = { sistema: "Sistema", claro: "Claro", oscuro: "Oscuro" };

  /** Selector de tema (solo de este dispositivo): se aplica y se guarda al elegir; no toca datos ni la cola de sincronización. */
  function dibujarTema(): Node {
    const actual = cargarTema(d.persistencia);
    const opciones = h("fieldset", { class: "segmentado", id: "ajuste-tema", "aria-describedby": "ayuda-tema" },
      h("legend", { class: "solo-lectores" }, "Tema"),
      ...TEMAS.map((t) => {
        const radio = h("input", { type: "radio", name: "tema", value: t, checked: t === actual }) as HTMLInputElement;
        radio.addEventListener("change", () => {
          if (!radio.checked) return;
          guardarTema(d.persistencia, t);
          aplicarTema(doc.documentElement, t);
          accion(() => { aviso = `Tema: ${NOMBRE_TEMA[t]}.`; });
        });
        return h("label", {}, radio, h("span", { class: "opcion" }, NOMBRE_TEMA[t]));
      }));
    return h("section", { class: "panel ajuste" }, h("h2", {}, "Apariencia"), opciones,
      h("p", { class: "suave", id: "ayuda-tema" }, "“Sistema” sigue el modo claro u oscuro de tu dispositivo. Se guarda solo en este dispositivo."));
  }

  /** Insignia de estado de una función opcional: activo (verde), desactivado (neutro) o falta configurar (aviso). */
  const claseEstadoOpcional = (e: { activo: boolean; configurado: boolean }) => (!e.activo ? "estado-nuevo" : !e.configurado ? "estado-aviso" : "estado-aldia");

  function textoAudioAjustes(e: EstadoAudio): string {
    if (!e.activo) return "Estado: desactivado.";
    if (!e.configurado) return "Estado: falta configurar (falta la clave en el servidor; ver SECRETOS.md).";
    return "Estado: activo.";
  }

  function dibujarAudioAjustes(s: ControlSync): Node {
    const titulo = h("h2", {}, "Entrada por audio (opcional)");
    const caja = (...hijos: Hijo[]) => h("section", { class: "panel ajuste audio-ajustes" }, ...hijos);
    const aviso1 = h("p", { class: "suave" },
      "Si lo activás, al grabar una idea el audio se manda a Groq para transcribirlo. No se guarda en ningún lado: el servidor lo descarta apenas responde. Si está desactivado, no sale ningún audio. Es opcional: la app funciona completa sin esto.");
    if (!s.hayCuenta() || !s.pedirConSesion) {
      return caja(titulo, aviso1, h("p", { class: "suave", id: "audio-ajustes-estado" }, "Iniciá sesión para configurarlo."));
    }
    if (!audioEstado) {
      return caja(titulo, aviso1,
        h("p", { class: "aviso", role: "alert", id: "audio-ajustes-estado" }, errorAudioAjustes || "No se pudo consultar el estado."));
    }
    const pedir = s.pedirConSesion.bind(s);
    const interruptor = h("input", { type: "checkbox", id: "audio-activo", checked: audioEstado.activo }) as HTMLInputElement;
    interruptor.checked = audioEstado.activo;
    interruptor.addEventListener("change", () => accion(async () => {
      const r = await pedir("/ajustes/audio", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ activo: interruptor.checked }) });
      if (!r.ok) throw new Error("No se pudo guardar el cambio.");
    }));
    interruptor.className = "interruptor";
    return caja(titulo, aviso1,
      h("label", { class: "tilde interruptor-fila" }, interruptor, h("span", {}, "Permitir dictar apuntes con el micrófono")),
      h("p", { id: "audio-ajustes-estado", class: `insignia-estado ${claseEstadoOpcional(audioEstado)}`, role: "status" }, textoAudioAjustes(audioEstado)),
      errorAudioAjustes && h("p", { class: "aviso", role: "alert" }, errorAudioAjustes));
  }

  /** Consulta el estado del respaldo externo (solo con sesión). Sin conexión o error: se avisa y la pantalla sigue andando. */
  async function cargarExterno(): Promise<void> {
    const s = d.sync;
    externo = null;
    errorExterno = "";
    if (!s || !s.pedirConSesion || !s.hayCuenta()) return;
    try {
      const r = await s.pedirConSesion("/ajustes/respaldo-externo");
      if (!r.ok) throw new Error("estado");
      externo = (await r.json()) as EstadoExterno;
    } catch {
      errorExterno = "No se pudo consultar el estado del respaldo externo (¿sin conexión?).";
    }
  }

  function textoExterno(e: EstadoExterno): string {
    if (!e.activo) return "Estado: desactivado.";
    if (!e.configurado) return "Estado: falta configurar (faltan las claves en el servidor; ver SECRETOS.md).";
    return "Estado: activo.";
  }

  function dibujarExterno(s: ControlSync): Node {
    const caja = (...hijos: Hijo[]) => h("section", { class: "panel ajuste respaldo-externo" }, ...hijos);
    const aviso1 = h("p", { class: "suave" },
      "Si lo activás, el servidor sube cada noche una copia CIFRADA de todos tus datos a tu bucket privado de Backblaze B2 (se conservan las últimas 30). Si está desactivado, no sale nada del servidor. Es opcional: la app funciona completa sin esto.");
    if (!s.hayCuenta() || !s.pedirConSesion) {
      return caja(h("h2", {}, "Respaldo externo (opcional)"), aviso1,
        h("p", { class: "suave", id: "externo-estado" }, "Iniciá sesión para configurarlo."));
    }
    const pedir = s.pedirConSesion.bind(s);
    const cambiar = (activo: boolean) => accion(async () => {
      const r = await pedir("/ajustes/respaldo-externo", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ activo }) });
      if (!r.ok) throw new Error("No se pudo guardar el cambio.");
    });
    const ahora = () => accion(async () => {
      const r = await pedir("/ajustes/respaldo-externo/probar", { method: "POST" });
      if (!r.ok) throw new Error("No se pudo respaldar ahora: activá el respaldo externo primero.");
      const x = (await r.json()) as { ok: boolean; mensaje: string };
      aviso = x.mensaje;
    });
    if (!externo) {
      return caja(h("h2", {}, "Respaldo externo (opcional)"), aviso1,
        h("p", { class: "aviso", role: "alert", id: "externo-estado" }, errorExterno || "No se pudo consultar el estado."));
    }
    const u = externo.ultimo_resultado;
    const interruptor = h("input", { type: "checkbox", id: "externo-activo", checked: externo.activo }) as HTMLInputElement;
    interruptor.checked = externo.activo;
    interruptor.addEventListener("change", () => cambiar(interruptor.checked));
    interruptor.className = "interruptor";
    return caja(
      h("h2", {}, "Respaldo externo (opcional)"),
      aviso1,
      h("label", { class: "tilde interruptor-fila" }, interruptor, h("span", {}, "Subir una copia cifrada cada noche")),
      h("p", { id: "externo-estado", class: `insignia-estado ${claseEstadoOpcional(externo)}`, role: "status" }, textoExterno(externo)),
      u && h("p", { id: "externo-ultimo", class: u.ok ? "suave" : "aviso" }, `Último resultado (${formatearInstante(u.cuando)}): ${u.mensaje}`),
      h("div", { class: "acciones" },
        boton("Respaldar ahora", ahora, "principal chico", externo.activo ? {} : { disabled: true })));
  }

  function dibujarCuenta(s: ControlSync): Node {
    cuentaDibujada = s.hayCuenta();
    const detalle = h("p", { id: "detalle-sync", class: "suave", role: "status" });
    if (cuentaDibujada) {
      return h("section", { class: "panel ajuste cuenta" },
        h("h2", {}, "Sincronización y cuenta"),
        h("p", { class: "suave" }, "Tus datos se guardan en este dispositivo y se sincronizan con tu servidor."),
        h("p", { class: "etiqueta" }, "Cuenta"),
        h("p", { class: "estado-linea" }, h("span", { class: "insignia-estado insignia-sync estado-nuevo" }, "")),
        h("p", {}, "Sesión iniciada: tus datos se sincronizan con el servidor."),
        detalle,
        h("div", { class: "acciones" },
          boton("Sincronizar ahora", () => { void s.sincronizarAhora(); }, "principal chico"),
          boton("Cerrar sesión", () => accion(async () => {
            await s.cerrarSesion();
            aviso = "Sesión cerrada. Tus datos siguen guardados en este dispositivo.";
          }), "suave chico")));
    }
    const clave = h("input", { type: "password", id: "cuenta-clave", "aria-label": "Contraseña", autocomplete: "current-password" }) as HTMLInputElement;
    const entrar = () => accion(async () => {
      const r = await s.iniciarSesion(clave.value);
      clave.value = "";
      errorCuenta = r.ok ? "" : r.mensaje;
      if (r.ok) aviso = "Sesión iniciada. Sincronizando…";
    });
    clave.addEventListener("keydown", (ev) => {
      const ke = ev as KeyboardEvent;
      if (ke.key === "Enter" && !ke.isComposing) { ke.preventDefault(); entrar(); }
    });
    return h("section", { class: "panel ajuste cuenta" },
      h("h2", {}, "Sincronización y cuenta"),
      h("p", { class: "suave" }, "Iniciá sesión para sincronizar tus datos con tu servidor. Sin sesión, todo sigue guardado en este dispositivo."),
      h("p", { class: "etiqueta" }, "Cuenta"),
      h("p", { class: "estado-linea" }, h("span", { class: "insignia-estado insignia-sync estado-nuevo" }, "")),
      detalle,
      h("label", {}, "Contraseña", clave),
      errorCuenta && h("p", { class: "aviso", role: "alert" }, errorCuenta),
      h("div", { class: "acciones" }, boton("Iniciar sesión", entrar, "principal chico")));
  }

  function dibujarRespaldo(): Node {
    const archivo = h("input", {
      type: "file", id: "archivo-respaldo", accept: ".json,application/json", "aria-label": "Archivo de respaldo",
      onchange: (ev: Event) => {
        const el = ev.target as HTMLInputElement;
        const f = el.files?.[0];
        if (!f) return;
        accion(async () => {
          const texto = await (d.leerArchivo ?? ((x: File) => x.text()))(f);
          informeRespaldo = await importarRespaldo(d.almacen, texto);
        });
      },
    }) as HTMLInputElement;
    return h("section", { class: "panel ajuste respaldo" },
      h("h2", {}, "Datos y respaldos"),
      h("p", { class: "suave" }, "Exportar descarga un archivo con todo (incluida la papelera y todos los repasos). Importar suma ese archivo a lo que ya tenés, sin borrar nada ni pisar lo más reciente."),
      h("div", { class: "acciones" },
        boton("Exportar todo", () => accion(async () => {
          const e = await exportarLocal(d.almacen, d.reloj);
          (d.descargar ?? ((n, t) => descargarEnNavegador(n, t)))(`lean-os-respaldo-${diaLogico(d.reloj)}.json`, JSON.stringify(e));
          aviso = `Se descargó el respaldo: ${e.tablas.tarjetas.length} tarjetas, ${e.tablas.repasos.length} repasos, ${e.tablas.tareas.length} tareas y ${e.tablas.apuntes.length} apuntes. Guardalo en un lugar seguro, por ejemplo Google Drive.`;
        }), "principal chico")),
      h("label", {}, "Importar un respaldo", archivo),
      informeRespaldo && h("div", { class: "informe", role: "status" },
        h("ul", { class: informeRespaldo.ok ? "" : "errores" }, ...lineasDeInforme(informeRespaldo).map((l) => h("li", {}, l)))));
  }

  /** Importar el respaldo del Lean OS original (ZIP de "Exportar todo" o sus JSON): suma sin duplicar y nunca pierde nada. */
  function dibujarMigracion(): Node {
    const archivo = h("input", {
      type: "file", id: "archivo-original", multiple: true, accept: ".zip,.json,application/zip,application/json", "aria-label": "Archivos del respaldo del Lean OS original",
      onchange: (ev: Event) => {
        const el = ev.target as HTMLInputElement;
        const elegidos = Array.from((el.files ?? []) as ArrayLike<File>);
        if (elegidos.length === 0) return;
        accion(async () => {
          const leer = d.leerBytes ?? (async (f: File) => new Uint8Array(await f.arrayBuffer()));
          const archivos: ArchivoAImportar[] = [];
          const fallos: string[] = [];
          for (const f of elegidos) {
            try { archivos.push({ nombre: f.name, bytes: await leer(f) }); }
            catch { fallos.push(`"${f.name || "(sin nombre)"}": no se pudo leer el archivo. No se cambió nada.`); }
          }
          let r: InformeMigracion;
          try {
            r = await importarRespaldoOriginal(d.almacen, d.reloj, archivos, { horaCambio: cargarAjustes(d.persistencia).horaCambio });
          } catch {
            r = { areas: 0, subareas: 0, temas: 0, creadas: 0, duplicadas: 0, avisos: [], errores: ["No se pudo importar el respaldo. No se cambió nada; probá de nuevo con otro archivo."] };
          }
          informeMigracion = { ...r, errores: [...fallos, ...r.errores] };
          try { el.value = ""; } catch { /* algunos navegadores no dejan limpiarlo: igual se redibuja */ }
        });
      },
    }) as HTMLInputElement;
    const l = informeMigracion ? lineasDeMigracion(informeMigracion) : null;
    return h("section", { class: "panel ajuste respaldo migracion", id: "migracion" },
      h("h2", {}, "Importar respaldo del Lean OS original"),
      h("p", { class: "suave" }, "Elegí el ZIP que descargaste con “Exportar todo” en el Lean OS original, o sus archivos JSON. Se suman a lo que ya tenés sin duplicar nada ni pisar tus repasos."),
      h("label", {}, "Archivos del respaldo original", archivo),
      l && h("div", { class: "informe", role: "status" },
        h("p", {}, h("strong", {}, l.resumen)),
        l.avisos.length > 0 && h("ul", { class: "avisos" }, ...l.avisos.map((x) => h("li", {}, x))),
        l.errores.length > 0 && h("ul", { class: "errores" }, ...l.errores.map((x) => h("li", {}, x)))));
  }

  /** Descarga un texto como archivo desde el navegador. */
  function descargarEnNavegador(nombre: string, texto: string): void {
    const ventana = doc.defaultView!;
    const url = ventana.URL.createObjectURL(new ventana.Blob([texto], { type: "application/json" }));
    const a = doc.createElement("a");
    a.href = url;
    a.download = nombre;
    doc.body.append(a);
    a.click();
    a.remove();
    ventana.setTimeout(() => ventana.URL.revokeObjectURL(url), 5000);
  }

  // ---------- teclado ----------
  doc.addEventListener("keydown", (ev) => {
    if (pantalla !== "repaso" || !repaso) return;
    const ke = ev as KeyboardEvent;
    const tag = (ke.target as HTMLElement | null)?.tagName ?? "";
    if (resumenRepaso) {
      // Con el resumen abierto solo valen Escape (cierra) y Tab (el foco se queda dentro); nada de atajos de calificación.
      if (ke.key === "Escape") {
        accion(() => { resumenRepaso = null; focoEn = "r-ver-resumen"; });
      } else if (ke.key === "Tab") {
        const dentro = [...principal.querySelectorAll<HTMLElement>("#r-resumen [tabindex='0'], #r-resumen button")];
        if (dentro.length === 0) return;
        const i = dentro.indexOf(doc.activeElement as HTMLElement);
        const sig = ke.shiftKey ? (i <= 0 ? dentro.length - 1 : i - 1) : (i < 0 || i === dentro.length - 1 ? 0 : i + 1);
        ke.preventDefault();
        dentro[sig]!.focus();
      } else if (ke.key === " " || /^[1-4]$/.test(ke.key) || ((ke.ctrlKey || ke.metaKey) && ke.key.toLowerCase() === "z")) {
        if (tag !== "BUTTON") ke.preventDefault();
      }
      return;
    }
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

  // Escape cierra el panel de estadísticas.
  doc.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key !== "Escape" || pantalla !== "hoy" || !panelEstadisticas) return;
    accion(() => { panelEstadisticas = false; });
  });

  // Escape cierra el menú, el resumen, el formulario de mover y la confirmación de borrado de Áreas.
  doc.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key !== "Escape" || pantalla !== "areas") return;
    if (!menuTema && !resumenAbierto && !moviendo && !confirmando) return;
    accion(() => {
      const c = confirmando;
      const tema = menuTema ?? moviendo ?? resumenAbierto;
      focoEn = c ? disparadorDe(c) : tema ? `a-menu-${tema}` : null;
      if (moviendo) recuerdo.delete(`a-mover-destino-${moviendo}`);
      menuTema = null; resumenAbierto = null; moviendo = null; confirmando = null;
    });
  });

  // Atajo de captura rápida: "n" fuera de los campos de texto abre la caja de apuntes.
  doc.addEventListener("keydown", (ev) => {
    const ke = ev as KeyboardEvent;
    const t = ke.target as HTMLElement | null;
    const tag = t?.tagName ?? "";
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || t?.isContentEditable) return;
    if (ke.key.toLowerCase() !== "n" || ke.ctrlKey || ke.metaKey || ke.altKey) return;
    ke.preventDefault();
    accion(() => { pantalla = "apuntes"; repaso = null; capturaAbierta = true; });
  });

  ir(inicial);
  return { ir, esperar: () => cola, raiz };
}
