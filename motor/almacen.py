"""Leer y escribir archivos JSON dentro de la carpeta de datos.

Junto con respaldo.py, es lo único que toca el disco.
Si algún día guardás los datos en otro lado (una base de datos, por ejemplo),
solo hay que cambiar este archivo.
"""

import json
import os
import threading
from pathlib import Path

# Archivo donde se anotan las huellas de todo lo ya importado, para no repetir nada.
# Está acá porque lo usan tanto importar.py (al importar) como areas.py (al eliminar un área).
ARCHIVO_HUELLAS = "importados.json"


class Almacen:
    """Representa la carpeta de datos."""

    def __init__(self, carpeta_datos):
        self.carpeta = Path(carpeta_datos)
        # El candado evita que dos pedidos guarden a la vez y se pisen.
        # Con un solo usuario casi no pasa, pero cuesta poco y evita sustos.
        self.candado = threading.Lock()
        (self.carpeta / "areas").mkdir(parents=True, exist_ok=True)

    def leer_json(self, ruta_relativa, valor_por_defecto):
        """Lee un archivo JSON. Si no existe, devuelve valor_por_defecto."""
        ruta = self.carpeta / ruta_relativa
        if not ruta.exists():
            return valor_por_defecto
        try:
            with open(ruta, encoding="utf-8") as archivo:
                return json.load(archivo)
        except json.JSONDecodeError as error:
            raise ValueError(
                f"El archivo {ruta} está dañado (línea {error.lineno}). "
                "Podés restaurarlo desde la carpeta respaldos."
            )

    def escribir_json(self, ruta_relativa, datos):
        """Guarda un JSON de forma segura.

        Primero escribimos en un archivo temporal y después lo renombramos.
        Así, si la PC se apaga a mitad de la escritura, el archivo original
        queda intacto en vez de quedar a medias (muy importante con la nube).
        """
        ruta = self.carpeta / ruta_relativa
        ruta.parent.mkdir(parents=True, exist_ok=True)
        temporal = ruta.with_name(ruta.name + ".tmp")
        with open(temporal, "w", encoding="utf-8") as archivo:
            # ensure_ascii=False deja las tildes legibles; indent=2 lo hace fácil de leer
            json.dump(datos, archivo, ensure_ascii=False, indent=2)
        os.replace(temporal, ruta)
