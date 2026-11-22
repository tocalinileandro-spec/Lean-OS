# Decisiones

Formato: fecha, qué se eligió, por qué.

## 2026-11-22 (fase 1, F1-base)

- **Estructura simple, sin workspaces.** `src/compartido/` (esquema, reloj, lógica compartida), `src/verificacion/` (lógica pura de verificar), `pruebas/`, `servidor/` (vacío hasta la fase 4). Menos piezas; se parte en workspaces solo si hace falta.
- **Vitest como runner.** Entiende TypeScript sin configuración extra, es rápido, sirve igual para cliente y servidor, y tiene reporter JSON que verificar.ts lee para mapear cada prueba a su ID. Alternativa descartada: `node:test`, que obliga a cargar TypeScript aparte y tiene un reporte menos cómodo.
- **verificar.ts se ejecuta con `node verificar.ts`** (Node >= 22.18 saca los tipos solo): no hace falta `tsx` ni compilar. Por eso los imports relativos llevan extensión `.ts`. El CI usa Node 22.
- **Dependencias (solo desarrollo):** `vitest` (runner), `typescript` (chequeo de tipos con `npm run tipos`) y `@types/node` (tipos de Node). Ninguna en producción.
- **Convención de IDs:** el nombre de cada prueba empieza con su ID (`I1: ...`). verificar.ts toma el ID de ese prefijo.
- **Lista exigible por fase** en `fase-actual.ts` (`IDS_EXIGIBLES`), separada de `TODOS_LOS_IDS`. Los IDs no exigibles sin pruebas salen en REPORTE.md como "pendiente (fase N)" sin hacer fallar; si tienen una prueba en rojo, igual falla. La lista solo se amplía al empezar cada fase (al cerrar la fase 1: B1; fase 2: I1-I7, R1-R9, S1; fase 3: T1, T2, A1, A2; fase 4: S2-S7, G1-G5, B3; B2 con la fase 5). **Nunca se reduce ni se mueve un ID a pendiente para hacer pasar algo.** Una prueba B1 verifica que B1 siga en la lista.
- **Falla también** cualquier prueba en rojo sin ID, o si vitest termina con error o no produce resultados.
- **REPORTE.md va en .gitignore:** se regenera en cada corrida y versionarlo genera conflictos sin aportar. El CI lo genera de nuevo.
- **.gitignore:** se mantuvieron las reglas de datos del prototipo (`datos/`, `papelera/`, `respaldos/`) y las de Python; se agregó `.env` (con excepción de `.env.example`), `node_modules/`, `dist/`.
- **Esquema (`src/compartido/esquema.ts`):** `rev` es `number | null` (null hasta que el servidor lo asigna). Los repasos también llevan `deleted_at` por uniformidad (siempre null, solo se agregan). Tarjeta lleva `contenido_updated_at` y `repaso_updated_at` además de `updated_at`. Las fechas locales son AAAA-MM-DD y los instantes ISO en UTC. Las áreas se modelan con `padre_id` (Área > Subárea).
- **Reloj:** interfaz `Reloj` con `ahora(): Date`; `RelojReal` y `RelojSimulado` (fijar/avanzar). El cambio de día a las 04:00 de Buenos Aires se implementará en la fase 2 sobre esta interfaz.
- **CI en `ci/ci.yml`:** checkout, setup-node 22, `npm ci`, `npm run verificar`; sin despliegue. El dueño lo copia a `.github/workflows/`.

## 2026-11-22 (fase 2, F2-a: importación)

- **Almacén:** interfaz `Almacen` (`src/compartido/almacen.ts`) con repositorios asíncronos por tabla (`obtener`, `listar`, `guardar`, `guardarVarios`); cada método es una transacción, así IndexedDB es directo. `listar` oculta los borrados salvo `incluirBorrados`. Repasos: solo `agregar` (idempotente por id) y listar. Implementación `AlmacenMemoria` para pruebas.
- **diaLogico(reloj, horaCambio, zona)** en `src/compartido/dia.ts`: resta la hora de cambio al instante y toma la fecha local con `Intl`. Sin dependencias.
- **I4, texto en la caja:** el informe devuelve `texto_original` (el texto pegado sin tocar); la UI lo deja en la caja cuando hay errores. La limpieza conserva el largo del texto, así la posición del error coincide con el texto pegado.
- **Posición del error:** si el JSON está cortado, la posición es el final del texto; si es inválido, la que informa `JSON.parse`. Se muestra posición, línea y columna.
- **Bloques:** se aceptan objetos pegados juntos y arreglos (cada elemento es un bloque). Un trozo ilegible se informa como error y no frena a los demás (la importación es idempotente, así que reintentar es seguro). Errores de bloque llevan el prefijo "Bloque N:" si hay más de uno.
- **Duplicadas:** se comparan solo contra tarjetas vivas (no borradas) del mismo área/subárea final, y también dentro del mismo bloque. Si el usuario deshace una importación y reimporta, se vuelven a crear. Aviso si la respuesta normalizada difiere.
- **Sin tarjetas nuevas** (todas duplicadas) no se registra importación ni apunte: así el reimport no duplica el resumen y "deshacer" apunta siempre a una importación con efecto.
- **Una importación por bloque** (el esquema no tiene lote). Deshacer revierte la última (por `created_at`, empate: la más reciente insertada) y la marca borrada; deshacer otra vez retrocede a la anterior. Las tarjetas ya editadas también van a la papelera (recuperables).
- **Área con más de 2 niveles** ("A > B > C") se rechaza nombrando el campo "area". "resumen" es opcional: sin resumen no se crea apunte. Título del apunte importado = tema.
- **Subárea:** se resuelve por nombre normalizado bajo su área padre; la tarjeta apunta a la subárea (o al área si no hay).
- **IDS_EXIGIBLES** ampliado con I1-I7.

## 2026-11-22 (fase 2, F2-b: repaso)

- **Código en `src/compartido/repaso.ts`:** `calificar` (pura, recibe el día lógico), `calificarYGuardar`, `deshacerCalificacion`, `construirCola` y `SesionRepaso` (cola en memoria con reencolado de "Otra vez").
- **Coma flotante:** ease se redondea a 2 decimales; los productos se redondean a 6 decimales antes del redondeo entero (mitad hacia arriba). Tope 365 días aplicado al final.
- **Ease en el intervalo:** Bien y Fácil usan el ease previo a la calificación (Fácil además lo sube 0,15 después de calcular). Por eso Fácil con intervalo 4 da luego 4×2,65×1,3.
- **Deshacer (Ctrl+Z):** restaura ease, intervalo, reps, lapses y vence de la tarjeta y agrega un repaso compensatorio con `anula_a` = id del original y valores invertidos. Es lo más simple que respeta "solo agrega" y no pierde datos. Se amplió `Repaso` con el campo opcional `anula_a`. `repasosVigentes()` descarta originales anulados y compensaciones (para estadísticas futuras).
- **Orden de guardado:** primero el repaso, después la tarjeta: si se corta entre ambos queda el repaso pero la tarjeta sin actualizar; `construirCola` la trata como pendiente de hoy (estado de nueva con repaso vigente, sin gastar cupo de nuevas) y vuelve a la cola. Se pierde a lo sumo esa calificación, que se repite.
- **Nueva:** intervalo 0, reps 0, lapses 0 y sin repasos vigentes. Una tarjeta calificada "Otra vez" ya no es nueva (lapses 1): entra como vencida (vence hoy).
- **Límite de nuevas:** 20 por defecto (`NUEVAS_POR_DIA`), parámetro `limiteNuevas`. Las nuevas ya repasadas hoy (primer repaso vigente en el día lógico actual) descuentan del límite, así reabrir la app no da otras 20. Nuevas en orden de creación.
- **Cola:** vencidas = vence <= hoy, más atrasadas primero (empate: orden de inserción). Excluye suspendidas y borradas.
- **Sesión y tarjetas borradas/suspendidas:** `SesionRepaso.siguiente()` descarta del frente las que se borraron o suspendieron durante la sesión; `calificar` lo usa, así no se traba.

## 2026-11-22 (fase 2, F2-c: IndexedDB, papelera, estadísticas, S1)

- **`fake-indexeddb` (devDependency):** simula IndexedDB en Node para probar `AlmacenIndexedDB` sin navegador. Solo en pruebas; el runtime no tiene dependencias.
- **Transacción única en operaciones multi-tabla:** se agregó `Almacen.guardarLote({areas, tarjetas, apuntes, importaciones})` (todo o nada). `importar` guarda tarjetas + apunte + importación con él, y `deshacerUltimaImportacion` también. No rompe pruebas ni cambia las demás firmas. El área se sigue guardando aparte antes (crear un área de más es inocuo y se reutiliza). `calificarYGuardar` (repaso + tarjeta) NO se pasó a lote: el orden repaso-primero ya está decidido en F2-b y cubre el corte; queda como está.
- **Orden de inserción en IndexedDB:** la clave es el UUID, así que cada registro lleva un `_seq` interno (contador por tabla en la store `contador`), que se quita al leer. Reemplazar conserva la posición.
- **Stores:** tarjetas, repasos, areas, metas, tareas, apuntes, importaciones, `contador` y `cola_cambios` (autoincremental, solo la store, sin lógica). `metas` y `tareas` existen en `AlmacenIndexedDB` pero la interfaz `Almacen` las incorpora en la fase 3. `AlmacenIndexedDB.abrir(nombre, fabrica)` recibe la fábrica de IndexedDB para pruebas.
- **Batería de contrato:** `pruebas/almacen-contrato.test.ts` corre las mismas pruebas contra `AlmacenMemoria` y `AlmacenIndexedDB`.
- **Purga:** `Repositorio.eliminarDefinitivo(ids)` (solo la usa la purga). `purgarPapelera` borra para siempre tarjetas, apuntes e importaciones con `deleted_at` de 30 días o más (inclusive); los repasos nunca se purgan. Cuando llegue la sync (fase 4) habrá que decidir cómo se propaga una purga; hoy es solo local.
- **Gestión (`src/compartido/gestion.ts`):** editar, mover de área, suspender/reanudar, borrar y restaurar actualizan `updated_at` y `contenido_updated_at` (suspendida y área pertenecen al grupo contenido). Pregunta/respuesta vacías se rechazan. Restaurar solo vale si está en la papelera. Tarea y meta se suman en la fase 3.
- **Estadísticas (`src/compartido/estadisticas.ts`):** pendientes hoy = largo de la cola del día; repasadas hoy = repasos vigentes del día lógico (cuenta calificaciones, no tarjetas distintas); racha = días lógicos seguidos con repaso vigente, y si hoy todavía no repasó cuenta desde ayer (no se corta hasta que termina el día); total por área: ver la corrección más abajo.
- **S1:** agregado a `IDS_EXIGIBLES`. La prueba verifica tarjetas, repasos, apuntes, áreas, importaciones y cola tras cerrar y reabrir; tareas se revalidan en la fase 3.
- **Corrección (revisión F2-c, ciclo 1):** el total por área ahora SUMA las subáreas en el Área (más sus tarjetas sin subárea); la subárea muestra solo las suyas. Revierte la decisión anterior "el padre no suma". Se cambió la aserción de `pruebas/gestion.test.ts` (Programación: 0 pasa a 3) porque fijaba un comportamiento erróneo según la sección 2, no para hacer pasar una prueba.
- **`AlmacenMemoria.guardarLote` atómico ante errores:** clona y valida todo (ids) antes de escribir, igual que la transacción de IndexedDB.

## 2026-11-22 (fase 2, F2-d: interfaz web del módulo 1, R9)

- **esbuild (devDependency):** compila y empaqueta el TypeScript del cliente en un solo `dist/app.js` (iife, minificado) sin configuración; ya venía como dependencia de vitest. Alternativa descartada: Vite (más piezas). `npm run build` = `node build.ts`: genera `dist/` con `index.html`, `app.js` y `estilos.css`. El iife (no módulo) permite abrir `dist/index.html` directo con doble clic, sin servidor.
- **happy-dom (devDependency):** DOM simulado para R9 y la prueba de punta a punta; más liviano y rápido que jsdom y sin navegador en el CI. Playwright no entra al repo.
- **Sin servicios externos:** fuente del sistema (Inter si está instalada, si no Segoe UI/system-ui) y CSP en `index.html` (`default-src 'none'`, solo recursos propios).
- **Separación lógica/DOM:** `src/cliente/ui/logica.ts` (sin DOM: ajustes, formato, `PantallaRepaso`, agrupado de tarjetas, vista de Hoy) y `src/cliente/ui/app.ts` (DOM, recibe almacén, reloj y persistencia por dependencias). `main.ts` solo arranca con IndexedDB real.
- **R9:** la vista de repaso recibe del modelo `respuesta` (y `pista`) únicamente después de pedirlas; el DOM se redibuja entero en cada paso y nunca se oculta con CSS. La prueba revisa `textContent` e `innerHTML`. La pista también queda fuera hasta tocar "Ver pista".
- **Acciones serializadas:** cada evento se encola (una a la vez) y redibuja al final; `esperar()` permite a las pruebas esperar. Ctrl+Z, Espacio y 1-4 solo actúan en Repaso; Espacio no se captura si el foco está en un botón (el botón ya responde solo) para no duplicar. Tras "Ver respuesta" el foco va al bloque de respuesta, no a un botón, para que un segundo Espacio no califique sin querer.
- **Intervalos en los botones:** se calculan con `calificar` (misma función que guarda). 0 días se muestra "Hoy"; si no, "N días".
- **Ajustes:** `localStorage` clave `lean-os:ajustes` (JSON), inyectado como `Persistencia` para probar. Guardan al cambiar cada campo. Para que la hora de cambio tenga efecto sin tocar las firmas de la lógica de repaso se agregó `fijarHoraCambio()` en `dia.ts` (valor por defecto global de `diaLogico`; sin llamarla sigue 04:00). `calcularEstadisticas` recibe ahora `opcionesCola` opcional para que "pendientes" respete el límite de nuevas configurado.
- **Tarjetas:** editar y mover de área están en el mismo formulario (selector "Área"); en la lista no se muestra la respuesta, solo la pregunta. La papelera muestra solo tarjetas (apuntes llegan en la fase 3). Importar: si hay errores el texto queda en la caja; si no, se vacía. Borrar no pide confirmación (va a la papelera, recuperable).
- **Fuera de esta tarea (fase 4):** exportar/importar respaldo, estado de sync, cerrar sesión, PWA. Tareas y Apuntes (fase 3): la navegación solo tiene Hoy, Repaso, Tarjetas y Ajustes.
- **IDS_EXIGIBLES** ampliado con R9. Se agregaron pruebas sin ID de recorrido completo (importar, repasar con teclado y Ctrl+Z, recarga con el mismo IDBFactory), ajustes y gestión.
- **CI:** `ci/ci.yml` corre `npm run build` antes de `npm run verificar`.

## 2026-11-22 (reglas nuevas del dueño para esta etapa)

- **Reglas que reemplazan a las anteriores** (instrucción expresa del dueño, 2026-11-22): (1) los agentes pueden escribir `.github/workflows`; `ci/ci.yml` se movió a `.github/workflows/ci.yml` (si GitHub rechaza un push de workflow: BLOQUEOS.md y el archivo queda en `ci/`). (2) El Director abre y fusiona los pull requests con CI verde y revisor aprobado; se elimina el requisito de CODEOWNERS, protección de rama y OK del dueño. (3) Tope de 10 tareas por sesión reemplazado por presupuesto de 20 horas acumuladas entre sesiones; se mantiene el tope de 3 ciclos programador-revisor por tarea. (4) Guardia de sesión en ESTADO.md: otra sesión activa con menos de 3 h o la palabra COMPLETO = terminar sin hacer nada.
- **Cambios en documentos:** CLAUDE.md, secciones 1, 7 y 9 de docs/VISION.md y `.claude/agents/programador.md`. En la sección 1 se agregó la excepción expresa para respaldo externo y audio (vienen desactivados; solo funcionan si el dueño los activa en Ajustes y carga su clave; la app funciona completa sin ellos) y se sacaron del "fuera de alcance" audio, recurrentes y gráficos, que pasan a opcionales con criterios O* propios.
- **Alcance de esta etapa:** fases 3, 4 y 5 más los opcionales (gráficos, recurrentes, respaldo externo, audio). El PR #1 (fases 1 y 2) ya estaba fusionado en `main` al empezar.
- **B1 (ruta):** la prueba ahora lee `.github/workflows/ci.yml` (antes `ci/ci.yml`) porque el workflow se movió por la regla nueva; los chequeos de contenido no cambian.

## 2026-11-22 (fase 3, F3-a: lógica de metas, tareas y apuntes)

- **Almacén:** `Almacen` y `Lote` incorporan `metas` y `tareas` (memoria e IndexedDB); la batería de contrato las cubre. `listarPapelera` devuelve también metas y tareas; `purgarPapelera` las purga con los mismos 30 días.
- **Módulos:** `src/compartido/tareas.ts` (metas, tareas, Hoy, Bandeja, progreso) y `src/compartido/apuntes.ts`. Borrar/restaurar apuntes sigue en `gestion.ts`.
- **Borrar meta:** un solo `guardarLote` (meta borrada, tareas con `meta_id` null, trimestrales hijas con `padre_id` null), atómico. Restaurar una meta NO vuelve a vincular tareas ni hijas (no se guarda el vínculo anterior; es lo más simple y no pierde datos).
- **Progreso:** hechas/vinculadas sobre tareas vivas; la anual suma las de sus trimestrales vivas; sin tareas = 0; porcentaje redondeado.
- **Hoy:** `atrasadas` = pendientes con fecha < hoy (más vieja primero); `hoy` = tareas con fecha de hoy, pendientes y hechas (las hechas se incluyen para poder desmarcar; T1 exige que Hoy la muestre ya hecha); `tarjetasARepasar` = largo de `construirCola`. Bandeja = pendientes sin fecha. Todo con `diaLogico`.
- **Validaciones:** título vacío rechazado; fecha debe ser AAAA-MM-DD; meta/área referenciada debe existir y estar viva; marcar hecha una ya hecha no cambia `hecha_en`.
- **Título derivado del apunte:** NO se guarda; `titulo` queda null y `tituloApunte()` lo calcula al mostrar (primeros 60 caracteres, espacios colapsados). Así sigue al texto si se edita y no se confunde con uno escrito a mano. A1 verifica `tituloApunte`.
- **Etiquetas:** se recortan y se descartan vacías y repetidas (comparando normalizado), conservando la primera escritura.
- **Búsqueda:** todas las palabras (normalizadas, por subcadena) deben estar en título + texto + etiquetas; filtros de tipo, etiqueta (normalizada, exacta) y área; resultados del más nuevo al más viejo.
- **Convertir a tarea:** título = título mostrado del apunte; nota = texto completo si difiere del título. El apunte no se borra ni se toca. **A tarjeta:** borrador `{pregunta: título mostrado, respuesta: texto, pista: null, area_id}`; no guarda nada.
- **S1 ampliado** (sin relajar lo existente) con metas, tareas (incluida una borrada), apuntes y captura. **IDS_EXIGIBLES** suma T1, T2, A1, A2.

## 2026-11-22 (fase 3, F3-b: interfaz de Tareas, Apuntes y papelera)

- **Archivos:** `src/cliente/ui/logica-tareas.ts` (lógica sin DOM: vistas de tareas/metas/apuntes y papelera), `src/cliente/ui/markdown.ts` (Markdown a nodos del DOM) y el DOM en `app.ts`. `vistaHoy` suma `atrasadas` y `tareas` usando `tareasDeHoy`. Pruebas en `pruebas/ui-tareas-apuntes.test.ts` (sin ID; T1, T2, A1 y A2 siguen donde estaban). Sin dependencias nuevas.
- **Navegación:** Hoy, Repaso, Tareas, Apuntes, Tarjetas, Ajustes.
- **Hoy:** atrasadas destacadas arriba (borde y color de aviso), campo de tarea rápida (Enter crea con fecha de hoy; vacío no hace nada; el foco queda en el campo para cargar varias), tareas de hoy con tilde que marca/desmarca al instante, y "Repasar N tarjetas" en un bloque pegado abajo (`sticky`). Sin tarjetas pendientes se conserva el mensaje de la fase 2.
- **Tareas:** además de la bandeja (sin fecha) se muestran "Con fecha" (pendientes con fecha, por si no es hoy) y las últimas 20 "Hechas"; sin eso una tarea con fecha futura o ya hecha no se vería en ningún lado. Formulario único para crear y editar (título, fecha, meta, nota). Metas: crear anual y trimestral (año y trimestre por defecto = hoy; padre opcional), cambiar estado con un selector, progreso informativo (barra y texto) y borrar. No se agregó edición de título de meta (no estaba pedida).
- **Apuntes:** captura rápida con botón "Nuevo apunte" o la tecla `n` (fuera de campos de texto, sin modificadores, desde cualquier pantalla); Ctrl+Enter guarda; guardar solo pide el texto. Búsqueda en vivo más filtros de tipo, etiqueta y área. Editar (título, texto, tipo, etiquetas separadas por coma, área). El título que se muestra siempre sale de `tituloApunte()`. "Pasar a tarea" crea la tarea en la bandeja y avisa; el apunte no se toca.
- **Pasar a tarjeta:** abre el formulario con el borrador de `convertirApunteATarjeta` (pregunta = título mostrado, respuesta = texto) y no guarda hasta "Guardar tarjeta". Para eso se agregó `crearTarjeta` en `gestion.ts` (tarjeta nueva: ease 2,5, vence hoy; no revisa duplicados, porque esa regla es de la importación) y se exportó `resolverArea` de `importar.ts` para unir áreas con la misma regla. El formulario deja elegir un área existente o escribir una nueva ("Área > Subárea"; si se escribe, gana); sin ninguna, avisa. Así funciona aun sin tarjetas previas.
- **Markdown:** negrita (`**x**`), listas con `-`/`*` y numeradas, y enlaces `[texto](url)` solo http(s). Se arma con `createElement`/`createTextNode` (nunca `innerHTML`), así todo texto del usuario queda escapado; un enlace con otro esquema (por ejemplo `javascript:`) se muestra como texto. Enlaces con `rel="noopener noreferrer"` y `target="_blank"`. Cursiva, títulos y código quedan como texto.
- **Papelera:** sigue en Tarjetas ("Ver papelera (N)"), ahora con las cuatro clases (tarjeta, tarea, meta, apunte; lo más reciente primero) y "Restaurar" con aviso por tipo. Se dejó ahí para no cambiar la pantalla ya probada; los avisos de borrado de tareas y apuntes indican dónde está.
- **Formularios que fallan:** si un guardado falla (por ejemplo título vacío), lo escrito se conserva (`recuerdo` en `app.ts`) y se limpia al terminar bien cualquier acción. El mensaje de error sigue en castellano (`mensajeDeError` ahora cubre "no puede estar vacío" y fechas/años inválidos).
- **R9 intacto:** no se tocó `PantallaRepaso` ni el flujo de repaso. Las acciones siguen serializadas y la pantalla se redibuja al final de cada una, así tareas y apuntes se ven al instante.
