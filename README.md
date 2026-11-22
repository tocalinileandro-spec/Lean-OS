# Lean OS

App personal de estudio y organización: tarjetas con repetición espaciada, tareas y metas, apuntes e ideas. Funciona sin conexión y se sincroniza con un servidor chico. La fuente de verdad es [docs/VISION.md](docs/VISION.md).

## Uso

```
npm ci
npm run verificar   # corre todas las pruebas y escribe REPORTE.md
npm run tipos       # chequeo de tipos
```

Requiere Node 22.18 o más. `prototipo/` es el prototipo viejo en Python, solo de referencia. Los secretos van en `.env` (ver `.env.example`), nunca en el repositorio.
