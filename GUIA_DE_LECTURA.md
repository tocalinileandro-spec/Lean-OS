# Cómo leer el código de Lean OS

No empieces por `web/app.py`. Empezá por lo más chico y andá subiendo.
Cada paso usa lo que ya leíste en el anterior.

## Orden de lectura

| # | Archivo | Líneas aprox. | Qué vas a aprender |
|---|---------|---------------|--------------------|
| 1 | `configuracion.json` | 8 | Qué se puede cambiar sin tocar código |
| 2 | `motor/repaso.py` | 30 | Las reglas de repaso: 2 funciones con `if` y listas. **Es el corazón de la app.** |
| 3 | `motor/errores.py` | 15 | Qué es una clase y por qué la usamos para errores |
| 4 | `motor/almacen.py` | 50 | Leer y escribir archivos JSON |
| 5 | `motor/areas.py` | 250 | Recorrer listas, ordenar, buscar; cómo `"A > B"` forma subáreas con solo el nombre |
| 5b | `motor/temas.py` | 85 | Mover y eliminar temas: por qué se guarda primero en el destino y recién después se saca del origen |
| 6 | `motor/tipos/aprendizaje.py` | 150 | Validar datos y dar mensajes de error claros |
| 7 | `motor/importar.py` | 100 | Cómo se evitan los duplicados (la "huella") |
| 8 | `motor/estudio.py` | 100 | Armar la fila de repaso y guardar respuestas |
| 9 | `motor/respaldo.py` | 70 | Crear archivos .zip |
| 10 | `pruebas/test_motor.py` | 190 | Ejemplos reales de cómo se usa cada función |
| 11 | `web/app.py` | 150 | Cómo una dirección web ("/repaso") llama al motor |
| 12 | `web/templates/*.html` | — | El HTML con `{{ }}` y `{% %}` (Flask los rellena) |
| 13 | `servidor.py` | 40 | Cómo arranca todo |

## Trucos para leer

- **Los comentarios explican el porqué**, no repiten lo que hace el código. Si un comentario te
  parece obvio, saltealo; si te intriga, es porque hay una razón detrás.
- **Las pruebas son la mejor documentación.** Si no entendés qué devuelve una función, buscá su
  nombre en `pruebas/test_motor.py` y mirá el ejemplo.
- **Probá cosas en vivo.** Abrí una terminal en la carpeta del proyecto y escribí:

      .venv\Scripts\python
      >>> from datetime import date
      >>> from motor import repaso
      >>> repaso.calcular_proximo_repaso(0, True, date.today())

  Cambiá los números y mirá qué pasa. Así se aprende más rápido que leyendo.
- **Una función a la vez.** No intentes entender el archivo entero; leé una función, mirá qué
  recibe y qué devuelve, y seguí.

## Qué pasa cuando tocás "Me acordé" (recorrido completo)

1. El navegador envía el formulario a la dirección `/repaso/responder`.
2. `web/app.py` → función `responder_repaso` recibe el pedido y llama a `estudio.responder`.
3. `motor/estudio.py` → `responder` carga el área, busca la pregunta y le pide a
   `repaso.calcular_proximo_repaso` el nuevo nivel y la nueva fecha.
4. Guarda el área con `areas.guardar_area`, que usa `almacen.escribir_json`.
5. `app.py` redirige a `/repaso`, que muestra la siguiente pregunta.

## Qué pasa cuando importás (recorrido completo)

1. `/importar/revisar` → `importar.revisar`: lee el texto, mira el campo `"tipo"`, y le pasa el
   trabajo a `tipos/aprendizaje.py` (`validar` y `describir`). **No guarda nada.**
2. Te muestra la vista previa y el botón "Confirmar y guardar".
3. `/importar/confirmar` → `importar.guardar`: valida de nuevo, revisa que la huella no exista y
   recién ahí guarda (`aprendizaje.guardar`) y anota la huella en `importados.json`.

## Ideas para practicar (cambios chicos y seguros)

1. En `motor/repaso.py`, cambiá `[1, 3, 7, 21, 60]` por otros intervalos y corré las pruebas:
   verás cuáles fallan y por qué.
2. En `web/static/estilos.css`, cambiá `--azul` por otro color y recargá la página.
3. En `web/app.py`, cambiá el texto de algún mensaje.

Las pruebas se corren con:

    .venv\Scripts\python -m unittest discover -s pruebas -t .
