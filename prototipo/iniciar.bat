@echo off
rem Doble clic para arrancar Lean OS.
cd /d "%~dp0"

rem La primera vez crea un "entorno" propio e instala Flask (necesita internet solo esta vez).
if not exist ".venv\Scripts\python.exe" (
    echo Primera vez: preparando el entorno, esto tarda un minuto...
    python -m venv .venv
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

".venv\Scripts\python.exe" servidor.py

rem Si el servidor se cae, esta pausa deja leer el mensaje de error antes de cerrar.
pause
