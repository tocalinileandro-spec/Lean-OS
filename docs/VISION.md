# Visión: App de estudio personal

Nov 22, 2026 · @leandro tocalini

## 1. Objetivo y principios

Esta app existe para que lo que aprendés, lo que tenés que hacer y lo que se te ocurre vivan en un solo lugar, sin cargar nada a mano y sin depender de Anki, Notion ni papel.

**Qué la hace distinta**

- Las tarjetas no se escriben: se importan como JSON que genera Claude a partir de lo que aprendiste.
- Son solo tres módulos (tarjetas, tareas, apuntes) y nada más. Si algo no está en este documento, no se construye.
- Es de una sola persona: sin registro, sin roles, sin compartir.
- Funciona sin internet y se sincroniza sola cuando vuelve la conexión.

**Principios**

1. **Simple primero.** Cada pantalla tiene una acción principal. Ante dos opciones, se elige la que tiene menos piezas.
2. **Los datos no se pierden.** Borrar siempre manda a la papelera y todo cambio grande tiene respaldo previo.
3. **Rápida.** Calificar una tarjeta lleva menos de 10 segundos y guardar una idea, menos de 5 (abrir, escribir, guardar).
4. **Primero sin conexión.** La app lee y escribe en su copia local; el servidor es el punto de encuentro entre dispositivos.
5. **Nada está terminado sin su prueba.** Cada función tiene un criterio verificable (sección 4).

**Lo que la app NO debe hacer nunca**

- Borrar o sobrescribir datos sin dejar una copia recuperable.
- Enviar tus datos a terceros (analítica, IA externa, publicidad). Excepción expresa: el respaldo externo y la entrada por audio (sección 8, opcionales) vienen desactivados y solo funcionan si el dueño los activa en Ajustes y carga su clave; la app funciona completa sin ellos.
- Mostrar la respuesta de una tarjeta antes de que toques “Ver respuesta”.
- Cambiar el formato JSON de importación sin una versión nueva y sin seguir aceptando el anterior.
- Guardar contraseñas, claves o tokens en el código, el repositorio o los registros.
- Agregar funciones fuera de los tres módulos sin que este documento lo diga.

**Fuera de alcance por ahora:** imágenes adjuntas, varios usuarios y app nativa de celular. (Entrada por audio, tareas recurrentes, respaldo externo y gráficos de estadísticas entran como opcionales, sección 8.)

## 2. Módulos y funcionalidades

Tres módulos y seis pantallas: Áreas (la de inicio), Repaso, Hoy, Tareas, Apuntes y Ajustes; la lista de Tarjetas (gestión) se abre desde Áreas. Hoy junta lo pendiente de los tres módulos.

### Módulo 1: Tarjetas con repetición espaciada

**Organización.** Cada tarjeta pertenece a un Área > Subárea (por ejemplo Programación > CS50) y tiene pregunta, respuesta y una pista opcional.

**Importar.** El botón “Importar” abre una caja donde se pega el bloque JSON. Antes de guardar, “Revisar” muestra qué pasaría (área, tema, preguntas nuevas y duplicadas) sin crear nada; al confirmar, la app muestra un informe: tarjetas creadas, duplicadas omitidas y errores. La caja nunca muestra errores ni informes antes de pegar algo. Este formato es un contrato y es el que genera Claude:

```json
{"tipo":"aprendizaje","fecha":"2026-11-22","area":"Programación > CS50","tema":"Funciones en Python","resumen":"Resumen de 2 a 4 líneas.","preguntas":[{"p":"¿Qué hace return?","r":"Devuelve un valor y termina la función.","pista":"Pensá en el código que sigue."}]}
```

**Áreas y temas.** La pantalla de inicio lista las áreas con sus subáreas, la cantidad de tarjetas, las que tocan hoy y una barra de dominio (tarjetas con intervalo de 21 días o más); permite crear áreas y entrar a cada una. Dentro de un área se crean subáreas y se ven sus temas (un tema es un bloque importado: su resumen y sus tarjetas); un tema se puede mover a otra área o subárea, y un tema, una subárea o un área se pueden borrar (papelera de 30 días, con restauración del conjunto). Dos niveles: Área > Subárea.

**Repasar.** Se puede repasar todo lo de hoy, un área (con sus subáreas) o una subárea, con chips que muestran cuántas tarjetas hay en cada una.

1. La pantalla muestra la etiqueta “Área › Subárea · Tema”, la pregunta (y la pista, si se la pide) y un enlace “Ver el resumen del tema”.
2. Tocás “Ver respuesta” (o Espacio).
3. Aparecen cuatro botones con el próximo intervalo de cada uno: Otra vez, Difícil, Bien y Fácil (atajos 1 a 4).
4. La app guarda al instante y pasa a la siguiente. Ctrl+Z deshace la última calificación.

La cola del día va así: primero las vencidas (las más atrasadas primero), después las nuevas (hasta 20 por día, configurable). Las tarjetas calificadas “Otra vez” vuelven al final de la cola.

**Cálculo del próximo repaso** (estilo SM-2). Cada tarjeta guarda ease (arranca en 2,5), intervalo en días, reps (repasos seguidos sin fallar), lapses (fallos) y fecha de vencimiento.

| Botón | Intervalo nuevo | Ease |
| --- | --- | --- |
| Otra vez | 0: vuelve en la misma sesión; reps pasa a 0 y lapses suma 1 | resta 0,20 (mínimo 1,3) |
| Difícil | máx(1, intervalo × 1,2) | resta 0,15 (mínimo 1,3) |
| Bien | reps 0: 1 día; reps 1: 3 días; después intervalo × ease | sin cambio |
| Fácil | reps 0: 4 días; después intervalo × ease × 1,3 | suma 0,15 |

Reglas del cálculo: reps suma 1 con Difícil, Bien y Fácil. El intervalo se redondea hacia arriba en la mitad (7,5 pasa a 8) y nunca supera 365 días.

**Gestión.** Lista por Área y Subárea con búsqueda. Se puede editar, mover de área, suspender (deja de aparecer en el repaso) y borrar (papelera).

**Estadísticas mínimas.** Pendientes hoy, repasadas hoy, racha de días seguidos con repaso y total de tarjetas por área.

**Gráficos (opcional, sección 8).** Desde Hoy se abre un panel de estadísticas con repasos por día (30 días), retención (Bien o Fácil sobre el total de 30 días), tarjetas por área y tareas hechas por semana (8 semanas), dibujados con SVG propio y sin servicios externos. Solo leen los datos: no agregan ni cambian nada.

### Módulo 2: Tareas y metas

- **Jerarquía.** Meta anual > meta trimestral > tarea. Cada nivel de arriba es opcional: una tarea puede no tener meta.
- **Tarea.** Título, fecha opcional, meta opcional, nota corta opcional y estado (pendiente o hecha). La tilde la marca hecha y guarda cuándo; se puede desmarcar.
- **Hoy.** Muestra las tareas con fecha de hoy y las atrasadas (arriba, destacadas), más un acceso fijo “Repasar N tarjetas”. Para agregar una tarea rápida alcanza con escribir el título y apretar Enter (la fecha queda en hoy).
- **Bandeja.** Las tareas sin fecha.
- **Metas.** La anual tiene año y título. La trimestral tiene año, trimestre (T1 a T4) y título, y puede colgar de una anual. Estados: activa, lograda o descartada. El progreso (tareas hechas sobre tareas vinculadas) es solo informativo.
- **Borrar.** Va a la papelera. Borrar una meta no borra sus tareas: quedan sin meta.
- **Repetición (opcional, sección 8).** Una tarea puede repetirse todos los días, ciertos días de la semana o un día del mes (si el mes no lo tiene, el último día). Al marcarla hecha se crea la siguiente ocurrencia, con fecha posterior a hoy y posterior a la propia (una atrasada no genera las intermedias). La siguiente tiene un id determinista de la serie y la fecha, así que marcar dos veces o en dos dispositivos no la duplica. “Dejar de repetir” corta la serie; borrar una ocurrencia solo borra esa.

### Módulo 3: Apuntes e ideas

- **Captura rápida.** Un botón (y un atajo) abre una caja de texto; al guardar se crea el apunte sin pedir nada más.
- **Campos.** Título opcional (si falta, se usan los primeros 60 caracteres), texto con Markdown simple (negrita, listas, enlaces), tipo (idea, apunte o aprendizaje), etiquetas y área opcional.
- **Buscar.** Texto libre sobre título, texto y etiquetas, con filtros por tipo, etiqueta y área.
- **Convertir.** Un apunte puede pasar a tarea o a tarjeta (se abre el formulario con el texto precargado).
- **Resúmenes importados.** El “resumen” de cada bloque JSON queda guardado como apunte de tipo aprendizaje, ligado al tema.
- **Borrar.** Papelera.

### Ajustes

Tarjetas nuevas por día (20), hora de cambio de día (04:00), tema (sistema, claro u oscuro; se guarda en el dispositivo), estado de sincronización, exportar todo (JSON), importar un respaldo, importar el respaldo del Lean OS original (el ZIP de su “Exportar todo” o sus archivos JSON, sin duplicar) y cerrar sesión.

## 3. Reglas de decisión

Ante cualquier duda, la app elige lo que no pierde datos y no pregunta; la única excepción es un borrado masivo.

| Situación | Qué hace |
| --- | --- |
| Tarjeta duplicada (mismo área y misma pregunta, sin importar mayúsculas, tildes ni signos) | No crea otra y conserva la existente. La lista como “duplicada omitida” y, si la respuesta es distinta, lo avisa en el informe. |
| El mismo bloque se importa dos veces | No crea nada nuevo: 0 creadas, todas duplicadas. |
| Se reimporta un bloque después de editar una tarjeta | La tarjeta cuenta como duplicada y no pisa la edición. |
| JSON con cercas de código, comillas tipográficas o comas finales | Lo limpia y lo importa. |
| JSON mal formado (no se puede leer) | No crea nada. Muestra el error con la posición aproximada y deja el texto pegado en la caja. |
| Falta un campo obligatorio (tipo, fecha, area, tema, preguntas), la fecha no es AAAA-MM-DD o una pregunta no tiene “p” o “r” | Rechaza el bloque entero y nombra el campo. Como importar es idempotente, se corrige y se vuelve a pegar. |
| “tipo” distinto de “aprendizaje” | Rechaza el bloque con el mensaje “Tipo no soportado: X”. |
| Varios bloques pegados juntos o un arreglo de bloques | Procesa cada bloque por separado; uno con error no frena a los otros. |
| Fecha del bloque | Es solo informativa: las tarjetas nuevas vencen hoy, sin importar la fecha. |
| Área escrita distinto (tildes, mayúsculas, espacios) | Se une con el área existente y se muestra la primera escritura registrada. |
| Área sin subárea | Se acepta y la tarjeta queda en el nivel Área. |
| Se importan más tarjetas nuevas que el límite diario | Se importan todas; el repaso muestra hasta el límite del día (20, configurable). |
| Se cierra la app o se corta la luz en medio de un repaso | Cada calificación ya está guardada; la tarjeta en curso vuelve a la cola. |
| Se borra una tarjeta, tarea, meta o apunte | Va a la papelera 30 días y se puede restaurar. Después se elimina; el historial de repasos se conserva. |
| Cambio de día | A las 04:00 de America/Argentina/Buenos\_Aires. Los vencimientos son fechas locales, sin hora. |
| Sin conexión | Todo funciona con la copia local; un indicador muestra cuántos cambios faltan sincronizar. |
| El mismo dato se cambia en dos dispositivos | Gana el cambio más reciente por grupo de campos (contenido o estado de repaso); el perdedor queda en el registro de sincronización. |
| Reloj mal puesto en un dispositivo | El servidor trata como “ahora” cualquier fecha con más de 5 minutos de futuro. |
| El servidor está vacío o más viejo que el cliente | El cliente nunca borra su copia por eso: sube lo que tiene. Así funciona la restauración. |
| Una sincronización borraría más del 20% de las tarjetas | Se rechaza y se pide confirmación manual. Es el único caso en que la app pregunta. |
| Falla una migración de base de datos | Hubo un respaldo previo automático: se restaura y no arranca la versión nueva. |

**Otras reglas**

- **Dudas que este documento no cubre.** El agente elige la opción más simple que no pierda datos, la anota en DECISIONES.md (fecha, qué eligió y por qué) y sigue sin preguntar.
- **Idioma.** La interfaz está en español rioplatense (“Tocá”, “Elegí”). Las fechas se muestran como dd/mm/aaaa y se guardan en ISO (AAAA-MM-DD; los instantes, en UTC).
- **Dependencias.** Las mínimas. Cada una nueva se justifica en una línea en DECISIONES.md y se prefiere la biblioteca estándar.
- **Diseño.** Sobrio, una acción principal por pantalla, tema claro u oscuro según el sistema (o el que se elija en Ajustes), usable con teclado en la PC y con el pulgar en el celular. La referencia visual es `docs/maqueta/` (Inter, azul #2563eb, radio de 20 px, botones pastilla, sombras suaves); barra superior en PC y barra inferior en celular, objetivos táctiles de 44 px, contraste AA, sin animaciones con `prefers-reduced-motion` e íconos SVG propios. Todo sin recursos externos.
- **Errores.** Mensajes en castellano que dicen qué pasó y qué hacer; nunca un error técnico crudo en pantalla.

## 4. Criterios de terminado verificables

Una función está terminada solo cuando su prueba pasa sola, sin intervención humana. Un único comando (`npm run verificar`) corre todas las pruebas con reloj simulado y datos de ejemplo, y escribe REPORTE.md con el resultado de cada ID. Para poder simular el tiempo, el código recibe el reloj como dependencia.

Prefijos: I importación, R repaso, T tareas, A apuntes, S sincronización, G seguridad, B build y entrega, O opcionales (respaldo externo O1-O6, audio O7-O12, tareas recurrentes O13-O19 y gráficos O20-O24; cada grupo se agrega antes de construirlo), P paridad con el Lean OS original y diseño (P1-P19, etapa 7).

| ID | Qué hace la prueba | Resultado esperado |
| --- | --- | --- |
| I1 | Importar un bloque válido con 3 preguntas en “Programación > CS50” | 3 tarjetas nuevas (ease 2,5, vencen hoy), el área Programación con subárea CS50 y el resumen guardado como apunte de tipo aprendizaje ligado al tema |
| I2 | Importar el mismo bloque otra vez | 0 creadas, 3 duplicadas omitidas; el total sigue en 3 |
| I3 | Importar un bloque con cercas de código y una coma final | Se importa igual que en I1 |
| I4 | Importar un JSON cortado a la mitad | 0 tarjetas creadas, mensaje con la posición del error y el texto sigue en la caja |
| I5 | Importar un bloque sin “preguntas” y otro con una pregunta de “r” vacía | Ambos rechazados, 0 creadas, el mensaje nombra el campo |
| I6 | Importar “programacion > cs50” existiendo “Programación > CS50” | Misma área: no se crea un área nueva |
| I7 | Deshacer la última importación | Sus tarjetas salen del repaso y quedan en la papelera |
| R1 | Tarjeta nueva y “Bien” | Intervalo 1, reps 1, ease 2,5, vence mañana |
| R2 | Cuatro “Bien” seguidos, avanzando el reloj lo necesario | Intervalos 1, 3, 8 y 20 días |
| R3 | Tarjeta nueva y “Fácil” | Intervalo 4, ease 2,65 |
| R4 | Tarjeta con reps 5 y “Otra vez” | reps 0, lapses suma 1, ease baja 0,20 y reaparece en la misma sesión |
| R5 | 20 “Otra vez” seguidos | El ease queda en 1,3, nunca menos |
| R6 | Una tarjeta cuyo cálculo daría más de 365 días | Se guarda 365 |
| R7 | Cola con tarjetas vencidas, una que vence mañana y 25 nuevas | Entran las vencidas y 20 nuevas; la de mañana no |
| R8 | Reloj simulado a las 03:59 y a las 04:00 | A las 03:59 sigue el día anterior; a las 04:00 empieza el nuevo |
| R9 | Abrir una tarjeta sin tocar “Ver respuesta” | El texto de la respuesta no está en la página |
| T1 | Crear meta anual 2026, meta trimestral T4 que cuelga de ella y una tarea de hoy que cuelga de la trimestral; marcarla hecha | Hoy la muestra y el progreso de ambas metas llega a 100 % |
| T2 | Borrar la meta trimestral | La tarea sigue existiendo, sin meta |
| A1 | Captura rápida solo con texto | Se crea el apunte con título de los primeros 60 caracteres |
| A2 | Buscar una palabra del texto y convertir el apunte en tarea | El apunte aparece en los resultados y la tarea existe con su texto |
| S1 | Cargar datos, cerrar y reabrir la app (en el navegador y, si se hace la fase 5, en el .exe) | Mismas tarjetas, estados de repaso, tareas y apuntes |
| S2 | Sin red: calificar 5 tarjetas y crear 1 tarea; volver la red | El servidor tiene los 5 repasos y la tarea |
| S3 | Repetir la sincronización dos veces seguidas | Sin duplicados (cada registro tiene id único) |
| S4 | Editar la misma tarea en dos clientes sin red | Gana la edición más reciente; la otra queda en el registro de sincronización |
| S5 | Servidor vacío y cliente con datos | El cliente conserva todo y lo sube |
| S6 | Enviar una sincronización que borra más del 20 % de las tarjetas | Rechazada con pedido de confirmación; no se borró nada |
| S7 | Exportar todo y reimportarlo en una instalación limpia | Mismos conteos y mismo estado de repaso en cada tarjeta |
| G1 | Pedir cualquier dato sin sesión | Error 401 |
| G2 | Equivocar la contraseña 6 veces en un minuto | La sexta recibe 429 (bloqueo temporal) |
| G3 | Entrar por HTTP | Redirige a HTTPS |
| G4 | Generar un respaldo y restaurarlo en un servidor vacío | Mismos conteos de cada tipo de dato |
| G5 | Buscar secretos en el repositorio y en los registros | Ninguno: el escaneo automático da vacío |
| B1 | Correr todas las pruebas en CI | Todas verdes; sin eso no hay despliegue |
| B2 | Solo con la fase 5: compilar el .exe en un runner de Windows y arrancarlo | Abre, responde en su puerto local de salud y se cierra sin error; no requiere instalar nada más |
| B3 | Desplegar en Fly.io y consultar /health | Responde “ok” por HTTPS |
| O1 | Respaldo externo desactivado (valor por defecto) y corre el respaldo nocturno | Se hace el respaldo local de siempre y no se hace ninguna llamada de red a terceros |
| O2 | Respaldo externo activado en Ajustes y con las claves cargadas; correr el respaldo nocturno contra un destino simulado | Se sube un archivo cifrado con el contenido completo; el archivo subido no contiene texto legible de tarjetas, tareas ni apuntes |
| O3 | Descifrar el archivo subido con la clave de cifrado y restaurarlo en un servidor vacío | Mismos conteos de cada tipo de dato (como G4); con una clave equivocada no restaura nada y avisa |
| O4 | Respaldo externo activado pero sin claves, o el destino falla o no responde | El respaldo local se hace igual, la app y la sincronización siguen normales, y Ajustes muestra “falta configurar” o el último error en castellano |
| O5 | Subir respaldos externos durante más de 30 días simulados | En el destino solo quedan los últimos 30 |
| O6 | Activar y desactivar el respaldo externo desde Ajustes; revisar los registros del servidor y la salida de una corrida | El estado se guarda en el servidor, exige sesión (401 sin ella) y ningún registro contiene claves ni contenido |
| O7 | Entrada por audio desactivada (valor por defecto): abrir la captura rápida y pedir la transcripción al servidor | No hay botón de micrófono, el servidor responde 403 y no se hace ninguna llamada de red a terceros |
| O8 | Audio activado y con clave: grabar y transcribir un audio de prueba contra un proveedor simulado | El texto devuelto aparece en la caja de captura sin guardarse solo; el apunte se crea únicamente al tocar Guardar (como A1) |
| O9 | Pedir transcripción sin clave cargada, sin sesión o sin conexión | Mensaje claro en castellano (“falta configurar”, “iniciá sesión” o “sin conexión”), 401 sin sesión, y la captura por texto sigue funcionando sin perder lo escrito |
| O10 | Mandar audio y revisar disco, base de datos y registros; mandar uno de más de 10 MB y uno de un tipo no permitido | El audio no se guarda en ningún lado y el servidor lo descarta tras la respuesta; los excesos reciben 413 y 415 con mensaje en castellano |
| O11 | El proveedor falla, no responde o devuelve cuota agotada | Mensaje en castellano, lo escrito en la caja no se pierde y la app y la sincronización siguen normales |
| O12 | Activar y desactivar el audio desde Ajustes; revisar respuestas, registros y el código del cliente | Exige sesión (401 sin ella), el estado se guarda en el servidor y la clave del proveedor no aparece en respuestas, registros ni en el cliente |
| O13 | Tarea diaria con fecha de hoy y marcarla hecha | Queda hecha y existe una tarea nueva, pendiente, con fecha de mañana, mismo título, nota, meta y regla |
| O14 | Tarea semanal (lunes y jueves) marcada hecha un lunes y otra un jueves | La del lunes genera la del jueves; la del jueves genera la del lunes siguiente |
| O15 | Tarea mensual del día 31 marcada hecha en enero, febrero (año común y bisiesto) y abril | La siguiente cae el último día del mes cuando el mes no tiene día 31 (28/29 de febrero, 30 de abril) y el 31 en los meses que sí |
| O16 | Tarea diaria atrasada 3 días marcada hecha hoy | Genera una sola tarea, con fecha posterior a hoy; no genera las ocurrencias intermedias |
| O17 | Marcar, desmarcar y volver a marcar la misma tarea recurrente, y marcarla en dos dispositivos sin conexión que luego sincronizan | Existe una sola ocurrencia siguiente (id determinista), sin duplicados |
| O18 | Crear una tarea con repetición desde el formulario, editar la regla, “dejar de repetir” y borrar una ocurrencia | La regla se guarda; al dejar de repetir ya no se generan más; borrar una ocurrencia solo borra esa (a la papelera); Hoy y Bandeja muestran la ocurrencia vigente |
| O19 | Tareas y respaldos creados antes de esta función (sin campos de repetición), sincronizarlos y exportar/importar una tarea con regla | Siguen siendo válidos y se comportan como antes (T1 y T2 intactos); el servidor acepta tareas con y sin regla; la regla se conserva en el export y la importación |
| O20 | Repasos de ejemplo repartidos en 30 días simulados (con un deshacer entre ellos) y abrir los gráficos | “Repasos por día” muestra la cantidad correcta de calificaciones vigentes de cada día lógico (lo deshecho y sus compensaciones no cuentan) y cero en los días sin repasos |
| O21 | Calcular la retención (respuestas Bien o Fácil sobre el total de los últimos 30 días) con datos de ejemplo y sin ningún repaso | El porcentaje es el correcto; sin repasos muestra “Sin datos” y nunca divide por cero |
| O22 | Tarjetas por área y tareas hechas por semana (últimas 8 semanas) con datos de ejemplo | Las barras por área suman las subáreas en el Área (igual que las estadísticas mínimas) y las tareas hechas se cuentan en la semana (lunes a domingo, día lógico) en que se marcaron |
| O23 | Abrir los gráficos con datos, sin datos, en tema claro y oscuro, y revisar la página | Se dibujan con SVG propio, sin librerías ni recursos externos (la política CSP no cambia), con rol de imagen, texto alternativo y los valores también como texto; sin datos muestran un estado vacío en castellano |
| O24 | 20.000 repasos y 5.000 tarjetas: calcular todos los gráficos; y las estadísticas mínimas de antes | El cálculo tarda menos de 500 ms y las estadísticas mínimas (pendientes hoy, repasadas hoy, racha, total por área) dan el mismo resultado que antes |
| P1 | Datos de ejemplo (3 áreas, una con 2 subáreas, 71 tarjetas, varias vencidas, nuevas y suspendidas), reloj simulado y pedir el resumen de áreas | Por área de primer nivel: subáreas, cantidad de tarjetas (suma las subáreas, sin borradas), “para hoy” (la misma cola del Repaso, con el tope de nuevas) y dominio en % (activas con intervalo de 21 días o más sobre activas; sin tarjetas, 0). La suma de “para hoy” de las áreas es igual al contador de “Todo lo de hoy” |
| P2 | Abrir la app con datos y sin datos | La primera pantalla es Áreas: tarjetas de área con “N tarjetas · M subáreas”, “N para hoy” o “Al día”, barra de dominio con su valor en texto y botón “Repasar hoy · N” (oculto si N es 0); sin áreas muestra un estado vacío con “Crear área” e “Importar” |
| P3 | Crear un área y una subárea desde la interfaz; crear “programacion” existiendo “Programación”; crear con nombre vacío o de más de 60 letras | Se crean y la subárea cuelga de su área; el repetido (sin importar tildes ni mayúsculas, como I6) no duplica y avisa en castellano; vacío y largo se rechazan con mensaje; nada se pierde |
| P4 | Repaso con chips: elegir “Todo lo de hoy”, un área y una subárea (con las tarjetas de P1) | Cada chip muestra su contador; el área incluye a sus subáreas y la subárea solo lo suyo; la cola respeta el tope de nuevas (R7); el filtro se mantiene durante la sesión; sin pendientes en el filtro muestra un estado vacío con la fecha de lo próximo |
| P5 | Abrir una tarjeta de una importación con subárea, otra sin subárea y una creada a mano; tocar “Ver el resumen del tema” | La etiqueta dice “Área › Subárea · Tema”, “Área · Tema” o “Área › Subárea”; los cuatro botones muestran el intervalo siguiente (R1 a R4 intactos); se ve “Tarjeta N de M”; el enlace abre el resumen y no revela la respuesta (R9 intacto); sin resumen el enlace no aparece |
| P6 | Detalle de un área con dos subáreas y temas; mover un tema a otra subárea y a otra área; mover al mismo lugar | Se listan subáreas con sus temas (nombre, tarjetas y “N hoy”, “Al día” o “Nuevo”) y “Repasar esta área · N”; al mover, las tarjetas conservan su estado de repaso y el resumen y la importación se mueven con ellas; al mismo lugar avisa y no cambia nada; no se pierde ni se duplica ninguna tarjeta |
| P7 | Borrar un tema, una subárea y un área con subáreas; ver la confirmación; restaurar; avanzar el reloj 30 días | La confirmación dice cuántas subáreas, temas y tarjetas se van; todo sale de Áreas, Repaso y estadísticas y queda en la papelera con el mismo instante de borrado; restaurar devuelve el conjunto con el estado de repaso intacto y sin resucitar lo que ya estaba borrado antes; a los 30 días se elimina, y los repasos se conservan |
| P8 | Importar con revisión: pegar un bloque válido y tocar “Revisar”; confirmar; cancelar; repetir con un bloque cortado | “Revisar” muestra área › subárea, tema, preguntas nuevas y duplicadas y el resumen, sin crear nada; “Confirmar” da el mismo resultado que I1 a I3; “Cancelar” no crea nada y deja el texto; el JSON roto muestra su error al revisar, con el texto en la caja (I4, I5) |
| P9 | Abrir la caja de importar sin pegar nada, después de una importación con errores y después de otra exitosa; tocar “Revisar” con la caja vacía | No hay errores, informes ni conteos visibles antes de pegar; “Revisar” vacío muestra un recordatorio amable en castellano y no crea nada |
| P10 | Importar el respaldo del original: un ZIP generado por el `Exportar todo` del prototipo (áreas con subáreas, temas, preguntas con nivel y fecha), un archivo de área suelto y `prototipo/ejemplos/aprendizaje_ejemplo.json` | Se crean áreas y subáreas (los niveles 3 o más se aplanan en el nombre de la subárea y se avisa), una importación y un apunte de aprendizaje por tema y las tarjetas con su pista; el estado se traduce (nivel 0: nueva, vence en `proxima`; nivel n de 1 a 5: intervalo de [1, 3, 7, 21, 60], reps n, ease 2,5, vence `proxima`); el ejemplo da 3 tarjetas en CS50; informe en castellano con áreas, temas, tarjetas creadas y duplicadas |
| P11 | Importar el mismo respaldo dos veces; con una tarjeta ya existente y calificada; con un archivo dañado y con uno que no es del original | La segunda vez crea 0 y todas son duplicadas; la tarjeta existente conserva su estado; el archivo dañado o ajeno da un mensaje en castellano y no cambia nada (todo o nada por archivo); `importados.json` y los respaldos del original se ignoran |
| P12 | Revisar el CSS y el HTML publicados | Hay variables CSS para color, radio (20 px), sombras, tipografía (Inter incluida en la app) y espaciado, en claro y oscuro; los botones son pastilla; no hay recursos externos ni atributos `style` en línea; la CSP solo suma `font-src 'self'` |
| P13 | Calcular el contraste de los pares texto/fondo de los tokens (texto, texto suave, acento, texto sobre acento, etiquetas de las cuatro calificaciones, insignias) en claro y oscuro | Todos cumplen AA: 4,5:1 o más para texto normal y 3:1 o más para texto grande y bordes de componentes |
| P14 | Cambiar el tema en Ajustes entre Sistema, Claro y Oscuro, recargar y simular el esquema de colores del sistema | Por defecto sigue al sistema (igual que hoy); la elección se guarda en el dispositivo, se aplica al abrir y no cambia datos, sincronización ni pruebas anteriores |
| P15 | Prueba de `verificar` sobre el CSS y el DOM (media query de 640 px, tamaños mínimos de 44 px de los controles, barras de navegación) y, de forma real, `npm run capturas` con Playwright a 390, 768 y 1440 px en claro y oscuro, que mide cada control y deja el resultado en `docs/capturas/medicion.json` (la prueba de `verificar` lo lee y exige cero incumplimientos) | A 640 px o menos hay barra inferior con Hoy, Repaso, Áreas, Tareas y Apuntes (Ajustes y Tarjetas se alcanzan desde la cabecera y Áreas); desde 641 px, barra superior; todo control interactivo mide 44 × 44 px o más en 390 px; no hay scroll horizontal en ningún ancho |
| P16 | Revisar las transiciones y animaciones del CSS con `prefers-reduced-motion: reduce` | Con la preferencia activa no hay transiciones ni animaciones; sin ella, solo transiciones suaves de 200 ms o menos |
| P17 | Revisar íconos, foco y navegación en los tres anchos | Los íconos son SVG propios con `aria-hidden` y texto al lado (sin emojis ni fuentes de íconos), el foco se ve, la pantalla activa lleva `aria-current` y el Repaso en celular muestra solo chips, progreso, tarjeta y botones |
| P18 | `npm run capturas` y revisar `docs/capturas/` | Existen PNG válidos de Áreas, Repaso (con la respuesta visible) y Detalle de área, a 390, 768 y 1440 px, en claro y oscuro (18 archivos o más), con nombre `<pantalla>-<ancho>-<tema>.png`; el revisor las miró y las aprobó (queda anotado en DECISIONES.md) |
| P19 | Correr todo `npm run verificar` y la sincronización contra el servidor con datos de antes de la etapa 7 | Todos los IDs de antes siguen verdes sin cambios en sus criterios; el esquema no cambia (sin migraciones) y los datos viejos se ven igual en las pantallas nuevas |

## 5. Arquitectura y tecnologías

Una sola app web que funciona sin conexión, se usa desde el navegador (instalable como PWA en la PC y el celular), con un .exe de Windows opcional, y un servidor chico en Fly.io que guarda los datos y los sincroniza.

&#91;embedded content: arquitectura · 2 clientes, 1 servidor, 1 CI\]

Cada dispositivo calcula y guarda todo en su copia local; el servidor solo autentica, guarda y sincroniza, y GitHub Actions prueba, compila el .exe y despliega.

**Tecnologías propuestas.** El agente programador lee primero el prototipo actual, que está en Python, y lo usa como referencia de comportamiento para portarlo todo a TypeScript; si algo de esta lista choca con el prototipo, decide y lo anota en DECISIONES.md.

- **Cliente compartido:** TypeScript en módulos, sin framework pesado y con una compilación mínima (esbuild o Vite, a elección del agente). La lógica de repaso, la importación y las reglas de la sección 3 viven en módulos propios con pruebas (`npm test`).
- **Copia local:** IndexedDB, en el navegador y, si se hace la fase 5, en el .exe. La app lee y escribe siempre ahí; la sincronización corre en segundo plano.
- **Servidor:** Node.js con TypeScript (Hono o Fastify, a elección del agente) y SQLite en un volumen de Fly.io. Guarda, autentica y sincroniza; no recalcula repasos. Se elige TypeScript para usar un solo lenguaje en cliente y servidor, el mismo del proyecto Abastex y el que el dueño está aprendiendo.
- **.exe de Windows (opcional, fase 5):** una ventana que carga la misma app empaquetada adentro (por eso abre sin conexión). La herramienta de empaquetado (por ejemplo Tauri o Electron) se elige en esa fase y se anota en DECISIONES.md.
- **PC y celular:** la misma web como PWA instalable (en la PC, desde Chrome o Edge).
- **Pruebas y entrega:** `npm test` para el cliente y el servidor, y GitHub Actions para correr todo, desplegar y, si se hace la fase 5, compilar el .exe.

**Datos.** Tablas: tarjetas, repasos (registro que solo agrega), áreas, metas, tareas, apuntes e importaciones. Todo registro lleva un id único generado en el cliente (UUID), created\_at, updated\_at, deleted\_at (borrado lógico para la papelera) y rev (contador que asigna el servidor). Las tarjetas llevan dos marcas de tiempo: una para el contenido y otra para el estado de repaso.

**Sincronización.**

1. El cliente guarda todo en su copia local y anota cada cambio en una cola.
2. Con conexión, envía la cola (`POST /sync/push`) y pide lo nuevo desde el último rev que vio (`GET /sync/pull?since=N`).
3. Cada cambio es idempotente por id: reenviarlo no duplica nada.
4. En un conflicto gana el updated\_at más reciente por grupo de campos (regla de la sección 3).
5. Resto de la API: `/auth/login`, `/export` y `/health`.

## 6. Seguridad y datos

Los datos viven en tres lugares a la vez (la copia local de cada dispositivo, el servidor y los respaldos), así que un solo fallo no alcanza para perderlos.

**Acceso**

- Un solo usuario con contraseña. No hay pantalla de registro ni forma de crear otros usuarios.
- La contraseña se guarda solo como hash (argon2) en un secreto del servidor, nunca en texto plano.
- La sesión usa un token de 30 días que se renueva al usarlo; cerrar sesión lo invalida.
- Todo viaja por HTTPS y HTTP redirige. El login admite 5 intentos por minuto.
- Ningún dato sale a terceros: sin analítica ni servicios externos.
- Los registros del servidor no incluyen contraseñas ni el contenido de tarjetas, tareas o apuntes.

**Copias de respaldo**

1. **Copia local.** Cada dispositivo guarda todo: es un respaldo vivo y está fuera del servidor.
2. **Servidor.** Snapshot diario del volumen de Fly.io (se activa y se verifica cuántos días retiene al desplegar) y, cada noche, un JSON completo en una carpeta de respaldos del mismo volumen, con los últimos 30.
3. **Manual.** “Exportar todo” descarga un JSON; conviene guardarlo de vez en cuando en Google Drive.

El JSON nocturno vive en el mismo volumen, así que contra la pérdida del volumen entero protegen las copias locales y el export manual.

**Contra la pérdida de datos por un bug**

- Borrado lógico y papelera de 30 días para todo.
- Respaldo automático antes de cada migración de base de datos; si la migración falla, se restaura.
- El cliente nunca borra su copia local porque el servidor esté vacío o falle.
- Una sincronización que borraría más del 20 % de las tarjetas se rechaza.
- Los repasos se guardan en un registro que solo agrega, así que el estado de una tarjeta se puede reconstruir.
- Los datos están en un volumen aparte del código: un despliegue nunca lo reemplaza.
- La restauración se prueba en cada versión (prueba G4).

## 7. Secretos y accesos

El proyecto necesita cuatro secretos (más los de las funciones opcionales que actives), todos con el menor permiso posible, y se cargan una sola vez al inicio.

| Secreto | Para qué sirve | Permisos mínimos | Dónde se carga |
| --- | --- | --- | --- |
| FLY\_API\_TOKEN | Desplegar en Fly.io desde GitHub Actions y desde la PC | Token de despliegue limitado a esta única app (`fly tokens create deploy`), sin acceso a otras apps ni a la cuenta | Secreto de GitHub Actions y archivo .env local |
| GITHUB\_TOKEN | Que el agente suba código y lea los resultados de CI | Token de acceso fino limitado a este único repositorio privado: Contents lectura y escritura, Pull requests lectura y escritura, Actions lectura, Metadata lectura. El agente puede escribir .github/workflows; si GitHub rechaza el push de un workflow, deja el archivo en ci/ y lo anota en BLOQUEOS.md | Archivo .env local o login de `gh` |
| APP\_PASSWORD\_HASH | Contraseña de la app (solo su hash) | No es una clave de un tercero: lo genera un script del repositorio a partir de la contraseña que elijas | Secreto de Fly.io |
| SESSION\_SECRET | Firmar los tokens de sesión | Cadena aleatoria de 32 bytes que genera el script de arranque | Secreto de Fly.io |
| B2\_KEY\_ID, B2\_APP\_KEY, B2\_BUCKET (opcional) | Respaldo externo en Backblaze B2 (plan gratuito de 10 GB, destino elegido en DECISIONES.md) | Application key de B2 limitada a ese único bucket, con permisos de listar, leer, escribir y borrar archivos solo ahí | Secretos de Fly.io |
| RESPALDO\_CLAVE (opcional) | Cifrar el respaldo antes de subirlo a un tercero (AES-256-GCM) | Cadena aleatoria de 32 bytes que genera el script de arranque. Guardala aparte (gestor de contraseñas): sin ella el respaldo externo no se puede abrir | Secreto de Fly.io y copia tuya fuera de Fly |
| GROQ\_API\_KEY (opcional) | Transcribir audio de la captura rápida con Whisper en Groq (plan gratuito, elegido en DECISIONES.md); la clave vive solo en el servidor | API key de Groq creada solo para esto (Groq no tiene permisos por clave; usar una clave dedicada y revocarla si se filtra) | Secreto de Fly.io |

**Reglas**

- El agente deja en SECRETOS.md una guía paso a paso (qué comando y dónde) para cargarlos todos de una vez.
- Ningún secreto va al repositorio: existe un `.env.example` con los nombres vacíos y `.env` está en .gitignore.
- El agente nunca imprime un secreto en pantalla, registros ni commits; la prueba G5 lo verifica.
- Si falta un secreto, el agente no se detiene: sigue con valores locales de desarrollo, marca el despliegue como pendiente en ESTADO.md y avisa al final.
- El .exe y el cliente web no llevan ninguna clave de terceros adentro.
- Cambiar SESSION\_SECRET cierra todas las sesiones abiertas; cambiar la contraseña es volver a correr el script.
- Si una fase opcional necesita otra clave (audio, respaldo externo), primero se agrega a esta tabla.

## 8. Plan por fases

Cuatro fases esenciales en orden y una quinta opcional (la app de Windows). Cada una deja la app funcionando y termina cuando sus pruebas (sección 4) están verdes.

1. **Base.** Leer el prototipo en Python (queda como referencia en la carpeta prototipo/, sin modificarlo), crear el repositorio, definir el esquema de datos, armar `npm run verificar`, la integración continua (en .github/workflows/ci.yml) y los archivos DECISIONES.md y ESTADO.md. Termina cuando: B1 corre.
2. **Tarjetas en local.** Importación, repaso con repetición espaciada, estadísticas mínimas, papelera y copia local. Termina cuando: I1 a I7, R1 a R9 y S1 en el navegador.
3. **Tareas y apuntes.** Metas, tareas, pantalla Hoy y bandeja; apuntes con captura rápida, búsqueda y conversiones. Termina cuando: T1, T2, A1 y A2.
4. **Servidor y sincronización.** Servidor en Node con TypeScript y SQLite, login, sincronización, respaldos, exportación, PWA instalable en el celular y despliegue en Fly.io. Termina cuando: S2 a S7, G1 a G5 y B3.
5. **App de Windows (opcional).** Solo si la PWA instalable no alcanza: empaqueta la misma app en un .exe y lo compila en GitHub Actions. Termina cuando: B2 y S1 dentro del .exe.

**Opcionales**, solo con las cuatro fases esenciales en verde y en este orden: respaldo externo fuera del volumen, entrada por audio, tareas recurrentes y gráficos de estadísticas. Cada una agrega primero sus criterios de terminado a la sección 4 (y su clave a la sección 7, si necesita una).

**Etapa 7 (pedida el 2026-11-23, después de las fases y opcionales):** paridad funcional con el Lean OS original y diseño profesional según `docs/maqueta/`. Cada tarea chica agrega o cumple IDs P1-P19; la lista de tareas está en ESTADO.md. No cambia el esquema de datos ni la sincronización.

**Cómo se avanza**

- No hay entorno de pruebas intermedio ni pedido de OK entre fases: el agente pasa a la siguiente apenas las pruebas de la fase están verdes.
- El primer despliegue a producción ocurre al terminar la fase 4, con CI verde; desde ahí, cada fase se despliega sola si CI queda verde.
- ESTADO.md se actualiza al cerrar cada fase. Al terminar la fase 4 (o la 5, si se hace) queda ahí la lista de lo pendiente o dudoso para tu revisión.

## 9. Roles de los agentes

Tres agentes trabajan en ciclo y solo se detienen en los casos de la lista de abajo; todo lo demás lo resuelven con este documento.

| Rol | Qué hace | Qué no hace |
| --- | --- | --- |
| Programador | Implementa una tarea chica por vez en una rama corta, escribe la prueba de su ID de la sección 4 junto con el código, deja commits pequeños y anota en DECISIONES.md lo que elige | No fusiona su propio trabajo, no cambia los criterios de la sección 4 para que pasen y no agrega funciones fuera del documento |
| Revisor | Corre `npm run verificar`, revisa el código contra las secciones 1, 3 y 6, intenta romper la función con casos raros (por ejemplo, un JSON con errores) y devuelve una lista concreta de fallas o aprueba | No arregla el código él mismo y no aprueba con una prueba en rojo o salteada |
| Director | Mantiene la visión: elige la próxima tarea según el plan, fusiona lo aprobado, actualiza ESTADO.md, frena el crecimiento del alcance y resuelve dudas con la sección 3 | No escribe código de funciones y no cambia este documento sin anotar el cambio y el motivo en DECISIONES.md |

**Ciclo de trabajo**

1. El director elige la próxima tarea del plan y la describe con los IDs de prueba que debe cumplir.
2. El programador la implementa y corre `npm run verificar`.
3. El revisor la verifica. Si falla, vuelve al programador con la lista de fallas; si pasa, el director la fusiona a main.
4. El director actualiza ESTADO.md y elige la siguiente tarea, sin esperar tu OK.

**Protecciones que no dependen del agente**

- A main solo se entra por pull request y con CI verde; nadie empuja directo. El Director abre y fusiona los pull requests cuando el CI está verde y el revisor aprobó. No hace falta CODEOWNERS, protección de rama ni OK del dueño.
- verificar.ts falla si falta alguno de los IDs de la sección 4 o si alguno está salteado, así que borrar o debilitar una prueba rompe el CI.
- El revisor mira el diff buscando pruebas eliminadas, relajadas o con tolerancias nuevas, y las rechaza.

**Topes de costo e intentos**

- Máximo 3 ciclos programador-revisor por tarea; al cuarto fallo se anota en BLOQUEOS.md y se pasa a otra tarea.
- Presupuesto de 20 horas de trabajo acumuladas entre todas las sesiones (reemplaza al tope de 10 tareas por sesión). El director anota en ESTADO.md la hora de inicio (comando `date`) y, al cerrar, suma lo trabajado al total. Al llegar a 20 h deja main estable con CI verde y termina.
- Si el contexto del director se llena, cierra dejando en ESTADO.md el próximo paso exacto y una marca de hora de "sesión activa". Al empezar, si ESTADO.md muestra otra sesión activa con menos de 3 horas, o dice COMPLETO, termina sin hacer nada.
- El consumo total lo limita el dueño desde su cuenta (el plan de suscripción o un límite de gasto en la API); los agentes no pueden subirlo. Las rutinas en la nube tienen además un tope diario de ejecuciones.
- Nada de refactors ni mejoras que nadie pidió sobre lo que ya pasa sus pruebas.

**Cuándo se detienen y te piden algo** (solo estos casos)

- Falta un secreto que no se puede simular y es lo único que impide avanzar. Dejan todo lo demás hecho.
- Una acción irreversible sobre datos reales: borrar o reemplazar el volumen de producción, o restaurar un respaldo encima de datos vivos.
- Algo implicaría un costo nuevo, como un plan de pago de Fly.io o un servicio externo, o se llegó al tope de 20 horas de la lista de topes de costo e intentos.
- Este documento se contradice o pide algo imposible.
- El mismo bloqueo sigue después de 3 enfoques distintos: lo anotan en BLOQUEOS.md y siguen con otra tarea; solo se detienen si no queda ninguna.

Al detenerse, el mensaje dice qué falta, qué ya está hecho y cuál es la opción por defecto. En cualquier otro caso deciden con la sección 3, lo anotan en DECISIONES.md y siguen.

**Dónde vive este documento**

Este documento se guarda en el repositorio como docs/VISION.md, y un CLAUDE.md corto en la raíz le dice a cada agente: leé docs/VISION.md antes de cada tarea, corré `npm run verificar` y respetá los roles de la sección 9. Los agentes obedecen la copia del repositorio, no esta página: si cambiás algo acá, copiá el cambio al repositorio.
