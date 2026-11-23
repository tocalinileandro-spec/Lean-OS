# Lean OS

App personal de estudio y organización: tarjetas con repetición espaciada, tareas y metas, apuntes e ideas. Funciona sin conexión y se sincroniza con un servidor chico. La fuente de verdad es [docs/VISION.md](docs/VISION.md).

## Qué es hoy

Una app web instalable (PWA) en español rioplatense, que anda sin conexión y se sincroniza con tu servidor. Pantallas:

- **Áreas** (inicio): tus áreas con subáreas, cuántas tarjetas tienen, cuántas tocan hoy y el porcentaje dominado. Adentro de cada área ves sus temas; de cada tema podés ver el resumen, moverlo a otra área o mandarlo a la papelera (con "Deshacer"). También se pueden crear áreas y subáreas e importar tarjetas con una vista previa antes de confirmar.
- **Repaso:** las tarjetas de hoy, filtradas por área o subárea, con la etiqueta "Área › Subárea · Tema" y el resumen del tema a mano.
- **Hoy**, **Tareas** (con metas y repetición), **Apuntes** (ideas y aprendizajes) y **Ajustes** (estudio, tema, cuenta, respaldos, migración).
- **Tema claro u oscuro:** Ajustes > Apariencia (Sistema, Claro u Oscuro).

## Pasar tus datos del Lean OS original

1. En el Lean OS original (el de `prototipo/`, con `iniciar.bat`), tocá **Exportar todo** en el menú de arriba. Descarga un ZIP `lean-os-AAAA-MM-DD.zip`.
2. En esta app abrí **Ajustes > Importar respaldo del Lean OS original**, elegí ese ZIP (o sus archivos JSON) y mirá el resumen que aparece.
3. Tus áreas, subáreas, temas, resúmenes y tarjetas quedan creados con su avance de repaso. Importar de nuevo el mismo archivo no duplica nada ni pisa los repasos que ya hiciste.

## Capturas de pantalla

`npm run capturas` abre la app en un Chromium sin ventana (hace falta Playwright instalado globalmente), mide las pantallas y guarda las imágenes en `docs/capturas/` a 390, 768 y 1440 px, en claro y oscuro.

## Uso

```
npm ci
npm run build       # genera dist/ (app, service worker, manifest, íconos)
npm run servidor    # sirve la app y la API en http://localhost:8080
npm run verificar   # corre todas las pruebas y escribe REPORTE.md
npm run tipos       # chequeo de tipos
npm test            # solo vitest
npm run restaurar -- <archivo>   # restaura un respaldo JSON en el servidor
npm run generar-secretos         # genera APP_PASSWORD_HASH y SESSION_SECRET
```

- [PROBAR.md](PROBAR.md): correr y probar la app en Windows (`cmd`), instalarla como PWA, dónde quedan los datos y cómo exportar.
- [SECRETOS.md](SECRETOS.md): cargar cada secreto y desplegar en Fly.io.

Los íconos de la PWA se regeneran con `node scripts/generar-iconos.ts`. El despliegue se hace con el `Dockerfile` y `fly.toml`; el CI despliega solo desde `main` si está cargado `FLY_API_TOKEN`.

Requiere Node 22.18 o más. `prototipo/` es el prototipo viejo en Python, solo de referencia. Los secretos van en `.env` (ver `.env.example`), nunca en el repositorio.
