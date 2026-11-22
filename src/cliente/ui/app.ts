/**
 * Interfaz web del módulo 1 (DOM). Dibuja lo que devuelve logica.ts y atiende eventos.
 * Recibe todo por dependencias (almacén, reloj, persistencia) y usa el documento de la raíz,
 * así se puede montar en un DOM simulado.
 */
import { deshacerUltimaImportacion, importar, type InformeImportacion } from "../../compartido/importacion/importar.ts";
import {
  borrarApunte, borrarTarjeta, crearTarjeta, editarTarjeta, moverTarjetaDeArea, reanudarTarjeta, suspenderTarjeta,
} from "../../compartido/gestion.ts";
import {
  convertirApunteATarea, convertirApunteATarjeta, crearApunte, editarApunte, tituloApunte, type BorradorTarjeta, type FiltrosApuntes,
} from "../../compartido/apuntes.ts";
import {
  borrarMeta, borrarTarea, cambiarEstadoMeta, crearMetaAnual, crearMetaTrimestral, crearTarea, crearTareaRapida, desmarcarHecha,
  editarTarea, marcarHecha,
} from "../../compartido/tareas.ts";
import { diaLogico } from "../../compartido/dia.ts";
import { TIPOS_APUNTE, type Apunte, type Calificacion, type EstadoMeta, type Id, type Tarea, type Tarjeta, type TipoApunte, type Trimestre } from "../../compartido/esquema.ts";
import {
  agruparTarjetas, cargarAjustes, formatearFecha, guardarAjustes, mensajeDeError, nombreDeArea, opcionesDeArea,
  PantallaRepaso, validarAjustes, vistaHoy, type Dependencias, type VistaRepaso,
} from "./logica.ts";
import {
  ESTADOS_META, etiquetaMeta, itemsPapelera, nombreTipoPapelera, restaurarItem, separarEtiquetas, textoProgreso,
  vistaApuntes, vistaTareas, type MetaConProgreso,
} from "./logica-tareas.ts";
import { renderizarMarkdown } from "./markdown.ts";

export type Pantalla = "hoy" | "repaso" | "tareas" | "apuntes" | "tarjetas" | "ajustes";
const PANTALLAS: { id: Pantalla; titulo: string }[] = [
  { id: "hoy", titulo: "Hoy" }, { id: "repaso", titulo: "Repaso" }, { id: "tareas", titulo: "Tareas" },
  { id: "apuntes", titulo: "Apuntes" }, { id: "tarjetas", titulo: "Tarjetas" }, { id: "ajustes", titulo: "Ajustes" },
];
const TIPOS_NOMBRE: Record<TipoApunte, string> = { idea: "Idea", apunte: "Apunte", aprendizaje: "Aprendizaje" };
/** Campos que conservan el foco al redibujar (se está escribiendo en ellos). */
const CAMPOS_CON_FOCO = ["busqueda", "busqueda-apuntes", "tarea-rapida"];

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
  let tareaEnForm: Id | "nueva" | null = null;
  let formMeta: "anual" | "trimestral" | null = null;
  let capturaAbierta = false;
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

  /** Serializa las acciones: una a la vez, y siempre se redibuja al final. */
  function accion(f: () => Promise<void> | void): void {
    cola = cola.then(async () => {
      aviso = ""; errorAjustes = "";
      const antes = firmaForm();
      await f();
      if (firmaForm() !== antes) recuerdo.clear(); // se cerró o cambió el formulario: lo escrito ya no vale
    }).catch((e) => { aviso = mensajeDeError(e); }).then(dibujar);
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
      else if (pantalla === "tareas") contenido.push(await dibujarTareas());
      else if (pantalla === "apuntes") contenido.push(await dibujarApuntes());
      else if (pantalla === "tarjetas") contenido.push(await dibujarTarjetas());
      else contenido.push(dibujarAjustes());
    } catch (e) {
      contenido.push(h("p", { class: "aviso", role: "alert" }, mensajeDeError(e)));
    }
    principal.replaceChildren(...contenido.filter((x): x is Node => !!x));
    // Si se estaba escribiendo en un campo (búsqueda), se conserva el foco; si no, va a la acción principal.
    const mismo = idActivo ? principal.querySelector<HTMLInputElement>(`#${idActivo}`) : null;
    if (mismo && CAMPOS_CON_FOCO.includes(mismo.id)) {
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
    const rapida = h("input", {
      type: "text", id: "tarea-rapida", placeholder: "Tarea rápida: escribí el título y apretá Enter", "aria-label": "Tarea rápida", autocomplete: "off",
      onkeydown: (ev: Event) => {
        const ke = ev as KeyboardEvent;
        if (ke.key !== "Enter" || ke.isComposing) return;
        ke.preventDefault();
        const campo = ke.target as HTMLInputElement;
        const titulo = campo.value;
        if (!titulo.trim()) return;
        campo.value = ""; // un segundo Enter seguido ya no encuentra nada para crear
        accion(async () => { await crearTareaRapida(d.almacen, d.reloj, titulo); });
      },
    });
    return h("section", {},
      h("h1", {}, "Hoy"),
      h("p", { class: "suave" }, v.fecha),
      v.atrasadas.length > 0 && h("div", { class: "atrasadas", role: "region", "aria-label": "Tareas atrasadas" },
        h("h2", {}, `Atrasadas (${v.atrasadas.length})`),
        h("ul", { class: "lista tareas" }, ...v.atrasadas.map((t) => filaTarea(t, { fecha: true })))),
      h("h2", {}, "Tareas de hoy"),
      rapida,
      v.tareas.length === 0
        ? h("p", { class: "suave" }, "No tenés tareas para hoy. Escribí una arriba y apretá Enter.")
        : h("ul", { class: "lista tareas" }, ...v.tareas.map((t) => filaTarea(t, {}))),
      h("div", { class: "acceso-fijo" },
        v.pendientes > 0
          ? boton(`Repasar ${v.pendientes} ${v.pendientes === 1 ? "tarjeta" : "tarjetas"}`, () => ir("repaso"), "grande principal", { "data-foco": "1" })
          : h("div", { class: "vacio" },
              h("p", {}, "No tenés tarjetas pendientes por ahora."),
              boton("Ir a Tarjetas", () => ir("tarjetas"), "suave", { "data-foco": "1" }))),
      h("dl", { class: "estadisticas" },
        h("div", {}, h("dt", {}, "Pendientes hoy"), h("dd", {}, String(e.pendientesHoy))),
        h("div", {}, h("dt", {}, "Repasadas hoy"), h("dd", {}, String(e.repasadasHoy))),
        h("div", {}, h("dt", {}, "Racha"), h("dd", {}, `${e.racha} ${e.racha === 1 ? "día" : "días"}`))),
      e.porArea.length > 0 && h("div", {},
        h("h2", {}, "Tarjetas por área"),
        h("ul", { class: "lista" }, ...e.porArea.map((a) => h("li", {}, h("span", {}, a.nombre), h("strong", {}, String(a.total)))))));
  }

  /** Fila de tarea con su tilde (marca o desmarca al instante). */
  function filaTarea(t: Tarea, o: { fecha?: boolean; acciones?: Hijo[]; meta?: string | undefined }): Node {
    const hecha = t.estado === "hecha";
    return h("li", { class: hecha ? "hecha" : "" },
      h("label", { class: "tilde" },
        h("input", {
          type: "checkbox", checked: hecha, "aria-label": `${hecha ? "Desmarcar" : "Marcar como hecha"}: ${t.titulo}`,
          onclick: () => accion(async () => { await (hecha ? desmarcarHecha : marcarHecha)(d.almacen, d.reloj, t.id); }),
        }),
        h("span", { class: "texto" }, t.titulo),
        (o.fecha || t.fecha) && h("span", { class: "suave" }, ` · ${t.fecha ? formatearFecha(t.fecha) : "sin fecha"}`),
        o.meta && h("span", { class: "suave" }, ` · ${o.meta}`)),
      t.nota && h("p", { class: "suave nota" }, t.nota),
      o.acciones && h("div", { class: "acciones" }, ...o.acciones));
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
    const lista = (ts: Tarea[], vacio: string) => ts.length === 0 ? h("p", { class: "suave" }, vacio) : h("ul", { class: "lista tareas" }, ...ts.map(fila));
    return h("section", {},
      h("h1", {}, "Tareas"),
      h("div", { class: "barra" }, boton("Nueva tarea", () => accion(() => { tareaEnForm = tareaEnForm === "nueva" ? null : "nueva"; }), "principal")),
      tareaEnForm === "nueva" && h("ul", { class: "lista" }, formularioTarea(null, opcionesMeta)),
      h("h2", {}, "Bandeja (sin fecha)"),
      lista(v.bandeja, "La bandeja está vacía."),
      h("h2", {}, "Con fecha"),
      lista(v.conFecha, "No hay tareas pendientes con fecha."),
      v.hechas.length > 0 && h("div", {}, h("h2", {}, "Hechas"), lista(v.hechas, "")),
      h("h2", {}, "Metas"),
      h("div", { class: "barra" },
        boton("Nueva meta anual", () => accion(() => { formMeta = formMeta === "anual" ? null : "anual"; }), "suave"),
        boton("Nueva meta trimestral", () => accion(() => { formMeta = formMeta === "trimestral" ? null : "trimestral"; }), "suave")),
      formMeta && formularioMeta(formMeta, v.metas.filter((m) => m.meta.tipo === "anual")),
      v.metas.length === 0 ? h("p", { class: "suave" }, "Todavía no hay metas.") : h("ul", { class: "lista metas" }, ...v.metas.map(filaMeta)));
  }

  function formularioTarea(t: Tarea | null, opcionesMeta: { id: Id; nombre: string }[]): Node {
    const titulo = h("input", { type: "text", id: "tarea-titulo", "aria-label": "Título", value: previo("tarea-titulo", t?.titulo ?? ""), "data-foco": "1" }) as HTMLInputElement;
    const fecha = h("input", { type: "date", id: "tarea-fecha", "aria-label": "Fecha", value: previo("tarea-fecha", t?.fecha ?? "") }) as HTMLInputElement;
    const nota = h("textarea", { id: "tarea-nota", rows: 2, "aria-label": "Nota" }, previo("tarea-nota", t?.nota ?? "")) as HTMLTextAreaElement;
    const metaLabel = select("tarea-meta", "Meta", opcionesMeta, previo("tarea-meta", t?.meta_id ?? ""), "Sin meta");
    const guardar = () => accion(async () => {
      recordar(titulo, fecha, nota, metaLabel.querySelector("select"));
      const datos = {
        titulo: titulo.value, fecha: fecha.value || null,
        meta_id: (metaLabel.querySelector("select") as HTMLSelectElement).value || null, nota: nota.value.trim() || null,
      };
      if (t) await editarTarea(d.almacen, d.reloj, t.id, datos);
      else await crearTarea(d.almacen, d.reloj, datos);
      tareaEnForm = null;
      aviso = t ? "Cambios guardados." : "Tarea guardada.";
    });
    return recordando(h("li", { class: "edicion" },
      h("label", {}, "Título", titulo), h("label", {}, "Fecha (opcional)", fecha), metaLabel, h("label", {}, "Nota (opcional)", nota),
      h("div", { class: "acciones" },
        boton("Guardar tarea", guardar, "principal chico"),
        boton("Cancelar", () => accion(() => { tareaEnForm = null; }), "suave chico"))));
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
        h("strong", {}, m.etiqueta), h("span", { class: "suave" }, m.meta.tipo === "anual" ? " · anual" : " · trimestral"),
        h("div", { class: "progreso" }, h("progress", { max: 100, value: m.progreso.porcentaje, "aria-label": "Progreso" }), h("span", { class: "suave" }, ` ${textoProgreso(m.progreso)}`))),
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
      type: "search", id: "busqueda-apuntes", placeholder: "Buscar en los apuntes", value: filtros.texto, "aria-label": "Buscar apuntes",
      oninput: (ev: Event) => { filtros.texto = (ev.target as HTMLInputElement).value; accion(() => undefined); },
    });
    const filtro = (id: string, clave: "tipo" | "etiqueta" | "area", etiqueta: string, ops: { id: string; nombre: string }[], todos: string) => {
      const l = select(id, etiqueta, ops, filtros[clave], todos);
      l.querySelector("select")!.addEventListener("change", (ev) => { filtros[clave] = (ev.target as HTMLSelectElement).value; accion(() => undefined); });
      return l;
    };
    return h("section", {},
      h("h1", {}, "Apuntes"),
      h("div", { class: "barra" }, boton("Nuevo apunte", () => accion(() => { capturaAbierta = !capturaAbierta; }), "principal", { title: "Atajo: tecla n" })),
      capturaAbierta && dibujarCaptura(),
      borradorTarjeta && formularioTarjeta(borradorTarjeta.b, v.areas),
      buscador,
      h("div", { class: "filtros" },
        filtro("filtro-tipo", "tipo", "Tipo", TIPOS_APUNTE.map((t) => ({ id: t, nombre: TIPOS_NOMBRE[t] })), "Todos"),
        filtro("filtro-etiqueta", "etiqueta", "Etiqueta", v.etiquetas.map((e) => ({ id: e, nombre: e })), "Todas"),
        filtro("filtro-area", "area", "Área", v.areas, "Todas")),
      v.apuntes.length === 0
        ? h("p", { class: "suave" }, filtrando ? "No hay apuntes que coincidan con la búsqueda." : "Todavía no hay apuntes. Tocá “Nuevo apunte” (o la tecla n) y escribí.")
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
    return h("div", { class: "captura" }, caja,
      h("div", { class: "acciones" },
        boton("Guardar apunte", guardar, "principal"),
        boton("Cancelar", () => accion(() => { capturaAbierta = false; }), "suave")));
  }

  function filaApunte(a: Apunte, areas: { id: Id; nombre: string }[]): Node {
    const area = a.area_id ? areas.find((x) => x.id === a.area_id)?.nombre : undefined;
    const datos = [TIPOS_NOMBRE[a.tipo], area, formatearFecha(diaDe(a.created_at)), ...a.etiquetas.map((e) => `#${e}`)].filter(Boolean).join(" · ");
    return h("li", { class: "apunte" },
      h("div", { class: "texto" },
        h("strong", {}, tituloApunte(a)),
        h("div", { class: "suave" }, datos),
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
    return recordando(h("div", { class: "edicion" },
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
      type: "search", id: "busqueda", placeholder: "Buscar en las tarjetas", value: busqueda, "aria-label": "Buscar tarjetas",
      oninput: (ev: Event) => { busqueda = (ev.target as HTMLInputElement).value; accion(() => undefined); },
    });
    const enPapelera = await itemsPapelera(d);
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
        : h("ul", { class: "lista" }, ...enPapelera.map((i) => h("li", {},
            h("span", {}, h("em", {}, `${nombreTipoPapelera(i.tipo)}: `), i.titulo),
            boton("Restaurar", () => accion(async () => { aviso = await restaurarItem(d, i.tipo, i.id); }), "suave chico")))),
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
