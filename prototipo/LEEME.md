# Lean OS

App personal para guardar lo que aprendés y repasarlo con repetición espaciada.
Corre en tu PC, sin internet y sin APIs. Un solo usuario.

## Cómo ejecutarla

1. Doble clic en **`iniciar.bat`**.
   - La primera vez crea un entorno propio e instala Flask (necesita internet solo esa vez).
   - Se abre una ventana de Edge con la app. Dejá abierta la ventana negra: es el servidor.
2. Para apagarla, cerrá la ventana negra.

## Versión descargable (.exe)

Doble clic en **`construir_exe.bat`**: crea la carpeta `dist\LeanOS` con `LeanOS.exe`.
Esa carpeta se puede copiar a cualquier PC con Windows (no necesita Python). La configuración
y los datos quedan al lado del .exe. Si cambiás el código, cerrá el programa y volvé a correr
`construir_exe.bat`: antes de rearmar, pone a salvo tu carpeta `datos` y tu `configuracion.json`
(dentro de `dist\LeanOS`) y después los devuelve. Igual conviene guardar los datos fuera de `dist`,
por ejemplo en OneDrive, cambiando `carpeta_datos`.

Para entender el código, leé `GUIA_DE_LECTURA.md`.

## Dónde se guardan tus datos

En `configuracion.json`, campo `carpeta_datos`. Ese archivo es personal y no se sube a GitHub: si no
lo tenés, copiá `configuracion.ejemplo.json` con ese nombre (o no hagas nada y se usan valores por
defecto). Por defecto, los datos van a la carpeta `datos` dentro del proyecto.
Para usar una carpeta sincronizada con la nube, poné la ruta completa con `/`:

    "carpeta_datos": "C:/Users/TuUsuario/OneDrive/lean_os_datos"

Dentro de esa carpeta:

    areas/            un archivo .json por área (adentro: temas y preguntas)
    importados.json   huellas de lo ya importado (así no se duplica)
    respaldos/        un .zip por día, automático y siempre al día con lo último que hiciste
                      (se guardan los últimos 30 días)
    papelera/         áreas eliminadas (para recuperar una, copiá su archivo a areas/ con el nombre
                      sin la fecha, por ejemplo python-20261115-201500.json -> python.json)

## Subáreas

Una subárea se escribe con `>` en el nombre: **`Programación > CS50`**.

- En un bloque JSON: `"area": "Programación > CS50"`. Si "Programación" no existe, se crea sola.
- En la pantalla: entrá al área y usá "Crear subárea".
- Repasar una área incluye todas sus subáreas; repasar la subárea, solo esa.
- Eliminar un área elimina también sus subáreas (la pantalla te avisa cuáles antes de confirmar).
- Se pueden anidar varios niveles: `Programación > Python > Funciones`.

## Eliminar o mover un tema

En la página de un área, cada tema tiene el desplegable **"Mover o eliminar este tema"**:

- **Mover a:** lista todas las demás áreas y subáreas. Las preguntas conservan su progreso de repaso.
- **Eliminar tema:** pide confirmación y guarda una copia en `papelera/` (archivo `tema_...json`, con el
  nombre del área de la que salió). Después podés volver a importar el mismo bloque si querés.

## Probar con un ejemplo

En Importar, pegá el contenido de `ejemplos/aprendizaje_ejemplo.json`.

## Pruebas automáticas

    .venv\Scripts\python -m unittest discover -s pruebas -t .

## Tipografía Inter

La app usa Inter si está instalada en Windows. Para que funcione siempre, copiá el archivo
`Inter.woff2` a `web/static/fuentes/`. Si no está, usa Segoe UI y se ve bien igual.

## Mapa de archivos

    iniciar.bat            doble clic: prepara todo y arranca
    servidor.py            lee la configuración y enciende el servidor
    configuracion.json     ruta de datos, dirección, puerto
    requirements.txt       librerías necesarias (solo Flask)
    motor/                 la lógica; no sabe nada de páginas web
      configuracion.py     lee configuracion.json
      almacen.py           lee y escribe archivos JSON de forma segura
      areas.py             áreas, subáreas y su eliminación
      temas.py             eliminar un tema o moverlo a otra área
      importar.py          valida, previsualiza y guarda bloques; evita duplicados
      tipos/               un archivo por tipo de bloque ("aprendizaje", más adelante "tareas"...)
      repaso.py            reglas de repetición espaciada (1, 3, 7, 21, 60 días)
      estudio.py           arma la fila de repaso y registra respuestas
      respaldo.py          respaldo diario y "Exportar todo"
      errores.py           errores con mensajes claros
    web/                   las páginas
      app.py               las rutas (qué pasa en cada dirección)
      templates/           el HTML
      static/              estilos.css y repaso.js
    pruebas/               pruebas automáticas
    ejemplos/              un bloque JSON de ejemplo

## Para pasarla a un servidor más adelante

- Cambiá `direccion` y `puerto` en `configuracion.json` (el servidor de `servidor.py` es solo
  para uso personal; para internet conviene un servidor de producción como waitress).
- El motor (`motor/`) no se toca. El login se agrega en `web/app.py`.
