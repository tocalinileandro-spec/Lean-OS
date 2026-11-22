"""Arranca Lean OS. Se ejecuta con iniciar.bat (o: python servidor.py).

Todo lo configurable (puerto, dirección, carpeta de datos) viene de configuracion.json.
"""

import subprocess
import threading
import webbrowser

from motor.configuracion import cargar_configuracion
from web.app import crear_aplicacion


def abrir_en_pantalla(url, como_abrir):
    """Abre la app: en una ventana propia de Edge, en el navegador, o no abre nada."""
    if como_abrir == "ventana":
        # "--app" hace que Edge muestre la página sin barra de direcciones ni pestañas
        subprocess.Popen(f"start msedge --app={url}", shell=True)
    elif como_abrir == "navegador":
        webbrowser.open(url)


def main():
    configuracion = cargar_configuracion()
    app = crear_aplicacion(configuracion)

    direccion = configuracion["direccion"]
    puerto = configuracion["puerto"]

    # 0.0.0.0 significa "escuchar en todas partes"; para abrirla nosotros usamos 127.0.0.1
    direccion_para_abrir = "127.0.0.1" if direccion in ("0.0.0.0", "") else direccion
    url = f"http://{direccion_para_abrir}:{puerto}"

    # Esperamos un momento para que el servidor ya esté escuchando cuando se abra la ventana
    threading.Timer(1.5, abrir_en_pantalla, args=[url, configuracion["como_abrir"]]).start()

    print(f"Lean OS funcionando en {url}")
    print(f"Datos guardados en: {configuracion['carpeta_datos']}")
    print("Para apagarlo, cerrá esta ventana (o presioná Ctrl+C).")

    # debug=False: el modo debug muestra código interno si algo falla, solo sirve para desarrollar
    app.run(host=direccion, port=puerto, debug=False)


if __name__ == "__main__":
    main()
