"""Eliminar un tema o moverlo a otra área.

Un "tema" es lo que importaste con un bloque de tipo "aprendizaje": un resumen con sus preguntas.
Vive dentro del archivo de un área; acá lo sacamos de ahí o lo pasamos a otro archivo.
"""

from datetime import datetime

from motor import areas


def _buscar_tema(area, id_tema):
    for tema in area["temas"]:
        if tema["id"] == id_tema:
            return tema
    raise ValueError("No encontré ese tema. Puede que ya lo hayas eliminado o movido.")


def _sin_el_tema(area, id_tema):
    """La lista de temas del área, sin el que tiene ese id."""
    return [tema for tema in area["temas"] if tema["id"] != id_tema]


def buscar_tema(almacen, slug_area, id_tema):
    """Devuelve (area, tema) o falla con ValueError si no existen."""
    area = areas.cargar_area(almacen, slug_area)
    if area is None:
        raise ValueError("No encontré esa área.")
    return area, _buscar_tema(area, id_tema)


def eliminar_tema(almacen, slug_area, id_tema, ahora=None):
    """Elimina el tema con todas sus preguntas. Devuelve el tema eliminado.

    No lo borra del todo: guarda una copia en la carpeta "papelera" (con el nombre del área
    de la que salió), por si te arrepentís.
    """
    ahora = ahora or datetime.now()

    with almacen.candado:
        area, tema = buscar_tema(almacen, slug_area, id_tema)

        # 1) Primero la copia a la papelera: si algo falla después, no se pierde nada.
        # (Usamos "tema_" con guion bajo: los nombres de áreas nunca lo tienen, así no se confunden.)
        marca_de_tiempo = ahora.strftime("%Y%m%d-%H%M%S")
        almacen.escribir_json(
            f"papelera/tema_{id_tema}-{marca_de_tiempo}.json",
            {"area": area["nombre"], "tema": tema},
        )

        # 2) Después lo sacamos del área
        area["temas"] = _sin_el_tema(area, id_tema)
        areas.guardar_area(almacen, area)

        # 3) Y olvidamos su huella, para poder volver a importar el mismo bloque si querés
        areas.olvidar_huellas_de_los_temas(almacen, {"temas": [tema]})
    return tema


def mover_tema(almacen, slug_origen, id_tema, slug_destino):
    """Pasa el tema de un área a otra (puede ser una subárea). Devuelve el área de destino.

    Las preguntas conservan su progreso de repaso: no se reinician.
    """
    if slug_origen == slug_destino:
        raise ValueError("Ese tema ya está en esa área.")

    with almacen.candado:
        origen, tema = buscar_tema(almacen, slug_origen, id_tema)
        destino = areas.cargar_area(almacen, slug_destino)
        if destino is None:
            raise ValueError("No encontré el área de destino.")

        # Guardamos primero en el destino y recién después sacamos del origen.
        # Si la PC se apagara justo en el medio, el tema quedaría repetido en las dos áreas
        # (se arregla eliminando uno), en vez de perderse.
        destino["temas"].append(tema)
        areas.guardar_area(almacen, destino)

        origen["temas"] = _sin_el_tema(origen, id_tema)
        areas.guardar_area(almacen, origen)
    return destino
