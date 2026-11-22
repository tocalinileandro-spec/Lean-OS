/**
 * Motor de sincronización del cliente (sin DOM). Recibe por dependencias: fetch, almacén, cola, reloj, persistencia
 * y programador de tiempos. Habla con el servidor de su mismo origen (rutas relativas).
 *
 * Reglas que no se rompen (secciones 3 y 6 de la visión):
 * - El cliente NUNCA borra nada local porque el servidor esté vacío, más viejo o falle (S5): si el servidor
 *   parece restaurado (su rev es menor que el cursor) o es la primera vez, se vuelve a subir todo.
 * - Lo que llega del servidor se aplica sin anotarlo en la cola y se fusiona con la regla de siempre.
 * - Un borrado masivo (409) no aplica nada y espera la confirmación del usuario.
 */
import type { Almacen, Repositorio } from "../../compartido/almacen.ts";
import { TABLAS } from "../../compartido/esquema.ts";
import type { Id, Registro, Repaso, Tabla } from "../../compartido/esquema.ts";
import type { Reloj } from "../../compartido/reloj.ts";
import type { Fila } from "../../compartido/respaldo-formato.ts";
import { Candado, contarPendientes } from "./cola.ts";
import type { CambioPendiente, ColaCambios, EntradaCola } from "./cola.ts";
import type { ConfirmacionPendiente, EstadoSync, FaseSync } from "./estado.ts";
import { fusionar } from "./fusion.ts";

export type FetchSync = (url: string, init?: RequestInit) => Promise<Response>;

export interface PersistenciaSync {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem?(clave: string): void;
}

export interface Programador {
  programar(accion: () => void, ms: number): unknown;
  cancelar(manija: unknown): void;
}

export const programadorReal: Programador = {
  programar: (f, ms) => setTimeout(f, ms),
  cancelar: (m) => clearTimeout(m as ReturnType<typeof setTimeout>),
};

export type ResultadoLogin = { ok: true } | { ok: false; mensaje: string };

/** Lo que usa la interfaz del motor. */
export interface ControlSync {
  estado(): EstadoSync;
  /** Actualiza el conteo de pendientes (lee la cola). */
  refrescar(): Promise<void>;
  suscribir(f: (e: EstadoSync) => void): () => void;
  hayCuenta(): boolean;
  iniciarSesion(password: string): Promise<ResultadoLogin>;
  cerrarSesion(): Promise<void>;
  sincronizarAhora(): Promise<void>;
  confirmarBorradoMasivo(): Promise<void>;
}

export interface OpcionesMotor {
  /** Almacén SIN decorar: lo que llega del servidor no se anota en la cola. */
  almacen: Almacen;
  cola: ColaCambios;
  fetch: FetchSync;
  reloj: Reloj;
  persistencia: PersistenciaSync;
  programador?: Programador;
  /** Para escuchar `online` (window). */
  eventos?: { addEventListener(tipo: "online", f: () => void): void };
  /** El mismo que usa el AlmacenSincronizado de la app (si no se pasa, no hay exclusión con las ediciones). */
  candado?: Candado;
  tamanoLote?: number;
  limitePagina?: number;
  /** Espera tras un cambio local antes de sincronizar (agrupa ráfagas). */
  esperaCambioMs?: number;
  /** Cada cuánto se sincroniza sola. */
  intervaloMs?: number;
}

const CLAVE_TOKEN = "lean-os:token";
const CLAVE_SYNC = "lean-os:sync";
const ESPERA_REINTENTO_MS = 5_000;
const ESPERA_REINTENTO_MAX_MS = 300_000;

interface EstadoPersistido {
  cursor: number;
  /** Falta hacer la subida completa (primera vez, servidor restaurado, cola rota). */
  subidaCompleta: boolean;
  ultimaVez: string | null;
}

class ErrorSync extends Error {
  tipo: "sin_conexion" | "sesion" | "confirmacion" | "servidor";
  confirmacion?: ConfirmacionPendiente;
  constructor(tipo: ErrorSync["tipo"], mensaje = "", confirmacion?: ConfirmacionPendiente) {
    super(mensaje);
    this.tipo = tipo;
    if (confirmacion) this.confirmacion = confirmacion;
  }
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class MotorSync implements ControlSync {
  #o: OpcionesMotor;
  #prog: Programador;
  #fase: FaseSync = "solo_local";
  #pendientes = 0;
  #error: string | null = null;
  #confirmacion: ConfirmacionPendiente | null = null;
  #versionDatos = 0;
  #fallos = 0;
  #enCurso: Promise<void> | null = null;
  #repetir = false;
  #repullCompleto = false;
  #verificadoLocal = false;
  #timerPeriodico: unknown = null;
  #timerCambio: unknown = null;
  #detenido = false;
  #sesionCerrada = false;
  #oyentes = new Set<(e: EstadoSync) => void>();

  constructor(opciones: OpcionesMotor) {
    this.#o = opciones;
    this.#prog = opciones.programador ?? programadorReal;
    this.#fase = this.hayCuenta() ? "sincronizado" : "solo_local";
  }

  // ---------- persistencia (siempre con try/catch: localStorage puede fallar) ----------

  #leer(clave: string): string | null {
    try {
      const v = this.#o.persistencia.getItem(clave);
      return v === "" ? null : v;
    } catch {
      return null;
    }
  }

  #escribir(clave: string, valor: string | null): void {
    try {
      if (valor === null) {
        if (this.#o.persistencia.removeItem) this.#o.persistencia.removeItem(clave);
        else this.#o.persistencia.setItem(clave, "");
      } else this.#o.persistencia.setItem(clave, valor);
    } catch {
      /* sin persistencia: se sigue en memoria de esta sesión */
    }
  }

  #leerEstado(): EstadoPersistido {
    try {
      const c = JSON.parse(this.#leer(CLAVE_SYNC) ?? "null") as Partial<EstadoPersistido> | null;
      if (c && typeof c.cursor === "number" && c.cursor >= 0) {
        return { cursor: c.cursor, subidaCompleta: c.subidaCompleta === true, ultimaVez: typeof c.ultimaVez === "string" ? c.ultimaVez : null };
      }
    } catch {
      /* se arranca de cero */
    }
    // Primera sincronización (o estado ilegible): subida completa desde cursor 0.
    return { cursor: 0, subidaCompleta: true, ultimaVez: null };
  }

  #guardarEstado(e: EstadoPersistido): void {
    this.#escribir(CLAVE_SYNC, JSON.stringify(e));
  }

  #token(): string | null {
    return this.#leer(CLAVE_TOKEN);
  }

  hayCuenta(): boolean {
    return this.#token() !== null;
  }

  // ---------- estado visible ----------

  estado(): EstadoSync {
    const fase: FaseSync = !this.hayCuenta() && this.#fase !== "sesion_vencida" ? "solo_local" : this.#fase;
    return {
      fase, pendientes: this.#pendientes, ultimaVez: this.#leerEstado().ultimaVez,
      confirmacion: this.#confirmacion, error: this.#error, versionDatos: this.#versionDatos,
    };
  }

  suscribir(f: (e: EstadoSync) => void): () => void {
    this.#oyentes.add(f);
    return () => this.#oyentes.delete(f);
  }

  #emitir(): void {
    const e = this.estado();
    for (const f of [...this.#oyentes]) {
      try {
        f(e);
      } catch {
        /* un oyente roto no frena la sincronización */
      }
    }
  }

  async refrescar(): Promise<void> {
    try {
      this.#pendientes = await contarPendientes(this.#o.cola);
    } catch {
      /* se conserva el último conteo */
    }
  }

  /** Espera a que termine la sincronización en curso (pruebas). */
  async esperar(): Promise<void> {
    while (this.#enCurso) await this.#enCurso;
  }

  // ---------- sesión ----------

  async iniciarSesion(password: string): Promise<ResultadoLogin> {
    if (password === "") return { ok: false, mensaje: "Escribí la contraseña." };
    let res: Response;
    try {
      res = await this.#o.fetch("/auth/login", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
      });
    } catch {
      return { ok: false, mensaje: "No hay conexión con el servidor. Probá de nuevo cuando tengas internet; mientras tanto la app funciona solo con los datos de este dispositivo." };
    }
    if (res.status === 401) return { ok: false, mensaje: "Contraseña incorrecta. Revisala y probá de nuevo." };
    if (res.status === 429) {
      const seg = Number(res.headers.get("retry-after"));
      const espera = Number.isFinite(seg) && seg > 0 ? `${Math.ceil(seg)} segundos` : "un minuto";
      return { ok: false, mensaje: `Demasiados intentos. Esperá ${espera} y probá de nuevo.` };
    }
    let token: unknown;
    try {
      token = res.ok ? ((await res.json()) as { token?: unknown }).token : undefined;
    } catch {
      token = undefined;
    }
    if (typeof token !== "string" || token === "") return { ok: false, mensaje: "No se pudo iniciar sesión. Probá de nuevo en un rato." };
    this.#escribir(CLAVE_TOKEN, token);
    this.#sesionCerrada = false;
    this.#fase = "sincronizado";
    this.#error = null;
    this.#fallos = 0;
    this.#emitir();
    this.#armarPeriodico();
    void this.sincronizar();
    return { ok: true };
  }

  /** Cierra la sesión en el servidor (si se puede) y borra el token. Los datos locales no se tocan. */
  async cerrarSesion(): Promise<void> {
    const token = this.#token();
    this.#sesionCerrada = true;
    this.#escribir(CLAVE_TOKEN, null);
    this.#fase = "solo_local";
    this.#error = null;
    this.#confirmacion = null;
    this.#cancelar("#timerPeriodico");
    this.#cancelar("#timerCambio");
    if (token) {
      try {
        await this.#o.fetch("/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      } catch {
        /* sin conexión: el token ya se borró acá; en el servidor vence solo */
      }
    }
    await this.refrescar();
    this.#emitir();
  }

  // ---------- disparadores ----------

  /** Arranca los disparadores: al abrir, al volver la red y cada ~60 s. */
  iniciar(): void {
    this.#detenido = false;
    this.#o.eventos?.addEventListener("online", () => {
      this.#fallos = 0;
      void this.sincronizar();
    });
    void this.refrescar().then(() => this.#emitir());
    if (this.hayCuenta()) {
      this.#armarPeriodico();
      void this.sincronizar();
    }
  }

  detener(): void {
    this.#detenido = true;
    this.#cancelar("#timerPeriodico");
    this.#cancelar("#timerCambio");
  }

  /** Lo llama el almacén decorado después de cada guardado: agrupa ráfagas y sincroniza tras una pausa corta. */
  cambioLocal(): void {
    void this.refrescar().then(() => this.#emitir());
    if (!this.hayCuenta() || this.#detenido) return;
    this.#cancelar("#timerCambio");
    this.#timerCambio = this.#prog.programar(() => {
      this.#timerCambio = null;
      void this.sincronizar();
    }, this.#o.esperaCambioMs ?? 2_000);
  }

  /** Pide una subida completa en la próxima sincronización (si falló anotar en la cola). */
  pedirSubidaCompleta(): void {
    const e = this.#leerEstado();
    e.subidaCompleta = true;
    this.#guardarEstado(e);
  }

  #cancelar(campo: "#timerPeriodico" | "#timerCambio"): void {
    const m = campo === "#timerPeriodico" ? this.#timerPeriodico : this.#timerCambio;
    if (m !== null) this.#prog.cancelar(m);
    if (campo === "#timerPeriodico") this.#timerPeriodico = null;
    else this.#timerCambio = null;
  }

  /** Próxima sincronización: cada intervalo, o con espera creciente tras fallos (5 s, 10 s, 20 s... hasta 5 min). */
  #armarPeriodico(): void {
    this.#cancelar("#timerPeriodico");
    if (this.#detenido || !this.hayCuenta()) return;
    const espera = this.#fallos > 0
      ? Math.min(ESPERA_REINTENTO_MS * 2 ** (this.#fallos - 1), ESPERA_REINTENTO_MAX_MS)
      : (this.#o.intervaloMs ?? 60_000);
    this.#timerPeriodico = this.#prog.programar(() => {
      this.#timerPeriodico = null;
      void this.sincronizar();
    }, espera);
  }

  /** Espera que va a usar el próximo reintento (para pruebas). */
  get fallosSeguidos(): number {
    return this.#fallos;
  }

  // ---------- sincronizar ----------

  async sincronizarAhora(): Promise<void> {
    this.#fallos = 0;
    await this.sincronizar();
  }

  async confirmarBorradoMasivo(): Promise<void> {
    this.#fallos = 0;
    await this.sincronizar({ confirmar: true });
  }

  /** Un solo sincronizar a la vez: si ya hay uno en curso, pide repetir al terminar y espera al actual. */
  async sincronizar(opciones: { confirmar?: boolean } = {}): Promise<void> {
    if (!this.hayCuenta()) {
      await this.refrescar();
      this.#emitir();
      return;
    }
    if (this.#enCurso) {
      this.#repetir = true;
      return this.#enCurso;
    }
    this.#enCurso = this.#correr(opciones.confirmar === true).finally(() => {
      this.#enCurso = null;
    });
    await this.#enCurso;
    if (this.#repetir && this.#fase === "sincronizado") {
      this.#repetir = false;
      await this.sincronizar();
    }
    this.#repetir = false;
  }

  async #correr(confirmar: boolean): Promise<void> {
    this.#fase = "sincronizando";
    this.#emitir();
    try {
      await this.#ciclo(confirmar);
      this.#fallos = 0;
      this.#fase = "sincronizado";
      this.#error = null;
      this.#confirmacion = null;
      const e = this.#leerEstado();
      e.ultimaVez = this.#o.reloj.ahora().toISOString();
      this.#guardarEstado(e);
    } catch (err) {
      const t = err instanceof ErrorSync ? err : new ErrorSync("servidor");
      if (t.tipo === "sesion" && this.#sesionCerrada) {
        // La sesión se cerró a propósito mientras sincronizaba: no es una sesión vencida.
        this.#fase = "solo_local";
      } else if (t.tipo === "sesion") {
        // Sesión vencida: se borra el token (ya no sirve) y no se toca ningún dato.
        this.#escribir(CLAVE_TOKEN, null);
        this.#fase = "sesion_vencida";
        this.#cancelar("#timerPeriodico");
      } else if (t.tipo === "confirmacion") {
        this.#fase = "confirmacion_pendiente";
        this.#confirmacion = t.confirmacion ?? null;
      } else if (t.tipo === "sin_conexion") {
        this.#fase = "sin_conexion";
        this.#fallos++;
      } else {
        this.#fase = "error";
        this.#error = t.message || "El servidor no pudo procesar la sincronización. Se reintenta solo; tus datos están a salvo en este dispositivo.";
        this.#fallos++;
      }
    }
    await this.refrescar();
    this.#emitir();
    if (this.#fase !== "sesion_vencida" && this.#fase !== "confirmacion_pendiente") this.#armarPeriodico();
  }

  async #ciclo(confirmar: boolean): Promise<void> {
    const st = this.#leerEstado();
    // Si localStorage sobrevivió pero la copia local quedó vacía (por ejemplo, datos del navegador borrados),
    // un cursor viejo se saltearía registros: se vuelve a empezar de cero.
    if (!this.#verificadoLocal) {
      if (st.cursor > 0 && (await this.#localVacio())) {
        st.cursor = 0;
        st.subidaCompleta = true;
        this.#guardarEstado(st);
      }
      this.#verificadoLocal = true;
    }
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      await this.#subir(st, confirmar);
      const r = await this.#bajar(st);
      if (r === "reiniciar") {
        // El servidor está más atrasado que este cliente (vacío o restaurado): se sube todo de nuevo (S5).
        st.cursor = 0;
        st.subidaCompleta = true;
        this.#guardarEstado(st);
        continue;
      }
      if ((await this.#o.cola.entradas()).length === 0) return;
    }
  }

  async #localVacio(): Promise<boolean> {
    for (const t of TABLAS) {
      if (t === "repasos") {
        if ((await this.#o.almacen.repasos.listar()).length > 0) return false;
      } else if ((await this.#repo(t).listar({ incluirBorrados: true })).length > 0) return false;
    }
    return true;
  }

  #repo(t: Exclude<Tabla, "repasos">): Repositorio<Registro> {
    return this.#o.almacen[t] as unknown as Repositorio<Registro>;
  }

  // ---------- red ----------

  async #pedir(ruta: string, init: RequestInit = {}): Promise<Response> {
    const token = this.#token();
    if (!token) throw new ErrorSync("sesion");
    let res: Response;
    try {
      res = await this.#o.fetch(ruta, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` } });
    } catch {
      throw new ErrorSync("sin_conexion");
    }
    if (res.status === 401) throw new ErrorSync("sesion");
    return res;
  }

  // ---------- subir ----------

  async #registrosAlmacen(): Promise<{ tabla: Tabla; registro: Fila }[]> {
    const todos: { tabla: Tabla; registro: Fila }[] = [];
    for (const tabla of TABLAS) {
      const lista: Fila[] = tabla === "repasos"
        ? ((await this.#o.almacen.repasos.listar()) as unknown as Fila[])
        : ((await this.#repo(tabla).listar({ incluirBorrados: true })) as unknown as Fila[]);
      for (const registro of lista) todos.push({ tabla, registro });
    }
    return todos;
  }

  async #registrosPendientes(entradas: EntradaCola[]): Promise<{ tabla: Tabla; registro: Fila }[]> {
    const vistos = new Set<string>();
    const unicos: CambioPendiente[] = [];
    for (const e of entradas) {
      const k = `${e.tabla}|${e.id}`;
      if (!vistos.has(k)) {
        vistos.add(k);
        unicos.push(e);
      }
    }
    const repasos = unicos.some((u) => u.tabla === "repasos") ? new Map((await this.#o.almacen.repasos.listar()).map((r) => [r.id, r])) : null;
    const salida: { tabla: Tabla; registro: Fila }[] = [];
    for (const u of unicos) {
      const r: Registro | Repaso | undefined = u.tabla === "repasos" ? repasos!.get(u.id) : await this.#repo(u.tabla).obtener(u.id);
      if (r) salida.push({ tabla: u.tabla, registro: r as unknown as Fila }); // purgado o inexistente: no hay nada que subir
    }
    return salida;
  }

  async #subir(st: EstadoPersistido, confirmar: boolean): Promise<void> {
    const entradas = await this.#o.cola.entradas();
    if (entradas.length === 0 && !st.subidaCompleta) return;
    const cambios = st.subidaCompleta ? await this.#registrosAlmacen() : await this.#registrosPendientes(entradas);
    const lote = this.#o.tamanoLote ?? 500;
    for (let i = 0; i < cambios.length; i += lote) {
      const res = await this.#pedir("/sync/push", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cambios: cambios.slice(i, i + lote), ...(confirmar ? { confirmar_borrado_masivo: true } : {}) }),
      });
      if (res.status === 409) {
        let c: unknown;
        try {
          c = await res.json();
        } catch {
          c = null;
        }
        const o = esObjeto(c) ? c : {};
        const vivas = Number(o["tarjetas_vivas"]) || 0;
        const aBorrar = Number(o["tarjetas_a_borrar"]) || 0;
        throw new ErrorSync("confirmacion", "", {
          tarjetas_vivas: vivas, tarjetas_a_borrar: aBorrar,
          mensaje: `Esta sincronización borraría ${aBorrar} de ${vivas} tarjetas. No se aplicó nada. Confirmá solo si es lo que querés.`,
        });
      }
      if (!res.ok) throw new ErrorSync("servidor", res.status === 400 ? "El servidor rechazó los datos. Se reintenta solo; tus datos están a salvo en este dispositivo." : "");
      const cuerpo = (await res.json().catch(() => null)) as { conflictos?: unknown[] } | null;
      // Si el servidor se quedó con otra versión, se vuelve a bajar todo para converger.
      if (cuerpo && Array.isArray(cuerpo.conflictos) && cuerpo.conflictos.length > 0) this.#repullCompleto = true;
    }
    await this.#o.cola.quitar(entradas);
    if (st.subidaCompleta) {
      st.subidaCompleta = false;
      this.#guardarEstado(st);
    }
  }

  // ---------- bajar ----------

  async #bajar(st: EstadoPersistido): Promise<"ok" | "reiniciar"> {
    let cursor = this.#repullCompleto ? 0 : st.cursor;
    this.#repullCompleto = false;
    const limite = this.#o.limitePagina ?? 500;
    for (;;) {
      const res = await this.#pedir(`/sync/pull?since=${cursor}&limite=${limite}`);
      if (!res.ok) throw new ErrorSync("servidor", "");
      const r = (await res.json()) as { rev: number; hay_mas: boolean } & Record<Tabla, Fila[]>;
      if (!r.hay_mas && cursor > 0 && r.rev < cursor) return "reiniciar";
      await this.#aplicar(r);
      cursor = r.rev;
      st.cursor = cursor;
      this.#guardarEstado(st);
      if (!r.hay_mas) return "ok";
    }
  }

  /** Aplica una página del servidor al almacén local SIN anotarla en la cola. Nunca borra. */
  async #aplicar(r: Record<Tabla, Fila[]>): Promise<void> {
    await (this.#o.candado ?? new Candado()).ejecutar(() => this.#aplicarBajoCandado(r));
  }

  /** Leer, fusionar y escribir en un solo paso exclusivo: ninguna edición local se cuela entre la lectura y la escritura. */
  async #aplicarBajoCandado(r: Record<Tabla, Fila[]>): Promise<void> {
    const lote: Record<string, Fila[]> = {};
    const aSubir: CambioPendiente[] = [];
    for (const tabla of TABLAS) {
      if (tabla === "repasos") continue;
      for (const rec of r[tabla] ?? []) {
        const local = (await this.#repo(tabla).obtener(rec["id"] as Id)) as unknown as Fila | undefined;
        const f = fusionar(tabla, local, rec, "entrante");
        if (f.cambio) (lote[tabla] ??= []).push(f.registro);
        if (f.subir) aSubir.push({ tabla, id: rec["id"] as Id });
      }
    }
    let cambios = Object.values(lote).reduce((n, l) => n + l.length, 0);
    if (cambios > 0) await this.#o.almacen.guardarLote(lote as never);
    const nuevos = r.repasos ?? [];
    if (nuevos.length > 0) {
      const existentes = new Set((await this.#o.almacen.repasos.listar()).map((x) => x.id));
      for (const rep of nuevos) {
        if (existentes.has(rep["id"] as Id)) continue;
        await this.#o.almacen.repasos.agregar(rep as unknown as Repaso);
        existentes.add(rep["id"] as Id);
        cambios++;
      }
    }
    if (aSubir.length > 0) await this.#o.cola.anotar(aSubir); // la fusión dejó algo más nuevo que el servidor
    if (cambios > 0) this.#versionDatos++;
  }
}
