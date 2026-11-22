# Lean OS

App personal de estudio y organización: tarjetas con repetición espaciada, tareas y metas, apuntes e ideas. Funciona sin conexión y se sincroniza con un servidor chico. La fuente de verdad es [docs/VISION.md](docs/VISION.md).

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
