"""Lee configuracion.json (la ruta de los datos, el puerto, etc.).

Este es el único lugar que sabe dónde está el archivo de configuración.
Así ninguna otra parte del programa tiene rutas escritas a mano.
"""

import json
import sys
from pathlib import Path

# La carpeta del proyecto es la que contiene a la carpeta "motor".
# La calculamos a partir de este mismo archivo para no escribir ninguna ruta fija.
if getattr(sys, "frozen", False):
    # Versión .exe: el código viaja empaquetado, así que la configuración y los datos
    # viven al lado del LeanOS.exe (para que puedas editarlos y moverlos).
    CARPETA_PROYECTO = Path(sys.executable).resolve().parent
else:
    CARPETA_PROYECTO = Path(__file__).resolve().parent.parent

# Si falta algo en configuracion.json, se usa este valor.
VALORES_POR_DEFECTO = {
    "carpeta_datos": "datos",
    "direccion": "127.0.0.1",  # 127.0.0.1 = solo se puede entrar desde esta PC
    "puerto": 5000,
    "como_abrir": "ventana",  # "ventana", "navegador" o "nada"
    "respaldos_a_conservar": 30,
}


def cargar_configuracion(ruta_archivo=None):
    """Devuelve un diccionario con la configuración lista para usar.

    La clave "carpeta_datos" vuelve como ruta absoluta (Path).
    """
    if ruta_archivo is None:
        ruta_archivo = CARPETA_PROYECTO / "configuracion.json"
    ruta_archivo = Path(ruta_archivo)

    configuracion = dict(VALORES_POR_DEFECTO)

    if ruta_archivo.exists():
        try:
            with open(ruta_archivo, encoding="utf-8") as archivo:
                configuracion.update(json.load(archivo))
        except json.JSONDecodeError as error:
            # Un mensaje claro vale más que un error técnico largo
            raise ValueError(
                f"configuracion.json tiene un error en la línea {error.lineno}: {error.msg}. "
                "Revisá las comas y las comillas (y usá / en las rutas, no \\)."
            )

    # Si la ruta es relativa ("datos"), la contamos desde la carpeta del proyecto.
    carpeta = Path(str(configuracion["carpeta_datos"])).expanduser()
    if not carpeta.is_absolute():
        carpeta = CARPETA_PROYECTO / carpeta
    configuracion["carpeta_datos"] = carpeta

    return configuracion
