# Lean OS

App personal para guardar lo que aprendés y repasarlo con repetición espaciada (1, 3, 7, 21 y 60 días).
Corre en tu PC (Windows), en el navegador por `localhost` o en su propia ventana. Un solo usuario,
sin internet ni APIs, con datos en archivos JSON simples pensados para vivir en una carpeta sincronizada.

Está escrita en Python (Flask) con código pensado para leerse y aprender: archivos chicos, nombres en
español y comentarios que explican el porqué.

## Qué hace

- **Importar:** pegás un bloque JSON, la app lo valida, te muestra qué va a guardar y pide confirmación.
  No duplica si pegás lo mismo dos veces.
- **Áreas y subáreas:** `Programación > CS50`. Cada área muestra sus temas con su resumen.
- **Repaso:** una pregunta a la vez, con pista y acceso al resumen del tema.
- **Temas:** se pueden mover entre áreas o eliminar (con copia en una papelera).
- **Datos:** carpeta configurable, respaldo diario automático y botón "Exportar todo".

## Cómo ejecutarla

1. Instalá [Python 3](https://www.python.org/downloads/) (marcá "Add Python to PATH").
2. Copiá `configuracion.ejemplo.json` como `configuracion.json` y editá `carpeta_datos` si querés
   guardar tus datos en otra carpeta (por ejemplo, en la nube). Si no lo hacés, usa la carpeta `datos`.
3. Doble clic en **`iniciar.bat`**. La primera vez instala Flask (necesita internet solo esa vez).

## Formato del bloque a importar

```json
{
  "tipo": "aprendizaje",
  "fecha": "2026-11-17",
  "area": "Programación > Python",
  "tema": "Listas y diccionarios",
  "resumen": "Texto del resumen.",
  "preguntas": [
    { "p": "¿Pregunta?", "r": "Respuesta", "pista": "opcional" }
  ]
}
```

Más detalles, la versión `.exe`, las pruebas y el mapa de archivos están en [`LEEME.md`](LEEME.md).
Para entender el código, empezá por [`GUIA_DE_LECTURA.md`](GUIA_DE_LECTURA.md).

## Licencias

La fuente Inter (`web/static/fuentes/Inter.woff2`) se distribuye bajo la SIL Open Font License 1.1;
ver `web/static/fuentes/LICENCIA-Inter.txt`.
