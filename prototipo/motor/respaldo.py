"""Copias de seguridad: una por día (siempre al día), automática, y "Exportar todo" a pedido.

Los respaldos son archivos .zip dentro de datos/respaldos/.
"""

import io
import zipfile
from datetime import date

CARPETA_RESPALDOS = "respaldos"


def _archivos_de_datos(almacen):
    """Todos los archivos de datos (menos los respaldos y los temporales)."""
    archivos = []
    for ruta in sorted(almacen.carpeta.rglob("*")):
        if not ruta.is_file() or ruta.suffix == ".tmp":
            continue
        relativa = ruta.relative_to(almacen.carpeta)
        if relativa.parts[0] == CARPETA_RESPALDOS:
            continue
        archivos.append((ruta, relativa))
    return archivos


def _armar_zip(almacen, destino):
    """Escribe todos los datos dentro de un zip. destino puede ser un archivo o memoria."""
    with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as paquete:
        for ruta, relativa in _archivos_de_datos(almacen):
            paquete.write(ruta, relativa.as_posix())


def exportar_todo(almacen):
    """Devuelve los bytes de un zip con todos los datos (para el botón "Exportar todo")."""
    memoria = io.BytesIO()
    _armar_zip(almacen, memoria)
    return memoria.getvalue()


def actualizar_respaldo_de_hoy(almacen, hoy=None, conservar=30):
    """Deja el respaldo de hoy al día con tus datos. Devuelve True si lo creó o lo renovó.

    Hay un solo archivo por día. Se crea en la primera visita y, si después cambiás algo
    (importás, repasás, movés...), se renueva para que siempre incluya lo último.
    El respaldo de los días anteriores no se toca.
    """
    hoy = hoy or date.today()
    carpeta = almacen.carpeta / CARPETA_RESPALDOS
    destino = carpeta / f"respaldo-{hoy.isoformat()}.zip"

    archivos = _archivos_de_datos(almacen)
    if not archivos:
        return False  # no hay nada que respaldar todavía

    # Esta comprobación es muy barata (solo mira fechas), así que se hace en cada visita.
    # Si el respaldo de hoy existe y es más nuevo que todos los datos, ya está al día.
    if destino.exists():
        ultimo_cambio = max(ruta.stat().st_mtime for ruta, _ in archivos)
        if ultimo_cambio <= destino.stat().st_mtime:
            return False

    carpeta.mkdir(parents=True, exist_ok=True)
    temporal = destino.with_name(destino.name + ".tmp")
    _armar_zip(almacen, temporal)
    temporal.replace(destino)

    _borrar_respaldos_viejos(carpeta, conservar)
    return True


def _borrar_respaldos_viejos(carpeta, conservar):
    """Deja solo los últimos N respaldos para que la carpeta no crezca para siempre."""
    # Los nombres llevan la fecha (AAAA-MM-DD), así que ordenar por nombre = ordenar por fecha
    respaldos = sorted(carpeta.glob("respaldo-*.zip"))
    for viejo in respaldos[:-conservar] if conservar > 0 else []:
        viejo.unlink()
