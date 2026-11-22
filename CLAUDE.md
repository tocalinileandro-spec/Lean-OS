# Lean OS: instrucciones para los agentes

Lean OS es la app personal de estudio y organización de Leandro: tarjetas con repetición espaciada, tareas y metas, y apuntes e ideas. Funciona sin conexión y se sincroniza con un servidor chico.

## Antes de cada tarea

1. Leé `docs/VISION.md`. Es la fuente de verdad: qué se construye, reglas de decisión, pruebas, secretos, plan por fases y roles.
2. Leé `ESTADO.md` (en qué fase estamos), `DECISIONES.md` y `BLOQUEOS.md`, si existen.
3. Si algo no está en `docs/VISION.md`, no se construye.

## Cómo se trabaja

- La sesión principal es el **Director** (sección 9 de la visión). Elige la próxima tarea del plan, la delega y fusiona lo aprobado.
- Los otros dos roles son subagentes definidos en `.claude/agents/`: `programador` y `revisor`. El Director los llama; ellos no llaman a otros agentes.
- Ciclo: Director describe la tarea con los IDs de prueba → `programador` implementa y corre `npm run verificar` → `revisor` verifica → si pasa, el Director fusiona; si falla, vuelve al programador con la lista de fallas.
- Una tarea chica por vez, en una rama corta (`tarea/<id>`), y entra a `main` solo por pull request con CI verde. Nadie empuja directo a `main`. El Director abre el pull request y lo fusiona cuando el CI está verde y el `revisor` aprobó; no hace falta CODEOWNERS, protección de rama ni OK del dueño.
- Nada está terminado hasta que `npm run verificar` pase. No se cambian, borran ni relajan los criterios de la sección 4 para que pasen.
- No se pide OK entre fases: el Director pasa a la siguiente apenas las pruebas de la fase están verdes.

## Reglas fijas

- **Lenguaje:** todo en TypeScript, cliente y servidor.
- **Prototipo:** todo lo que hoy está en el repo, salvo CLAUDE.md, docs/ y .claude/ (las carpetas motor, pruebas, web y ejemplos, servidor.py, los .bat, los requirements y las guías), es el prototipo viejo en Python. En la fase 1 se mueve entero a prototipo/ sin modificarlo y se usa solo como referencia de comportamiento..
- **Secretos:** nunca en el repo, en registros ni en commits. Usá `.env.example` con los nombres vacíos. Los agentes pueden escribir `.github/workflows`. Si GitHub rechaza el push de un workflow, se anota en `BLOQUEOS.md`, el archivo queda en `ci/` y se sigue.
- **Memoria entre sesiones:** cada sesión arranca sin recuerdos, así que todo lo importante va a archivos. `ESTADO.md` se actualiza al cerrar cada tarea y cada fase; las decisiones van a `DECISIONES.md` (fecha, qué se eligió, por qué); los bloqueos a `BLOQUEOS.md`.
- **Idioma:** la interfaz va en español rioplatense. Los commits y los archivos de estado, en español.

## Topes

- Máximo 3 ciclos programador-revisor por tarea. Al cuarto fallo: anotar en `BLOQUEOS.md` y pasar a otra tarea.
- Presupuesto de **20 horas de trabajo acumuladas entre todas las sesiones** (en lugar del tope de tareas por sesión). Al empezar, el Director anota en `ESTADO.md` la hora de inicio (comando `date`); al cerrar suma lo trabajado al total. Al llegar a 20 h deja `main` estable con CI verde y termina.
- Si el contexto se llena, el Director cierra dejando en `ESTADO.md` el próximo paso exacto y una marca de hora de "sesión activa". Al empezar, si `ESTADO.md` muestra otra sesión activa con menos de 3 horas, o dice COMPLETO, termina sin hacer nada.
- Nada de refactors ni mejoras que no estén pedidas sobre lo que ya pasa sus pruebas.

## Cuándo parar y avisar

Solo en los casos de la lista "Cuándo se detienen y te piden algo" de la sección 9 de `docs/VISION.md`. Al parar, el mensaje dice qué falta, qué ya está hecho y cuál es la opción por defecto. En cualquier otro caso se decide con la sección 3, se anota en `DECISIONES.md` y se sigue.
