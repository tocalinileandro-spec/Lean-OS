"""Armar la fila de repaso y registrar tus respuestas.

Usa las reglas de repaso.py y los archivos de areas.py.
"""

from datetime import date, datetime

from motor import areas as modulo_areas
from motor import repaso


def _areas_a_considerar(almacen, slug_area):
    """Las áreas que entran en un repaso.

    Sin slug: todas. Con slug: esa área y todas sus subáreas
    (repasar "Programación" incluye lo de "Programación > CS50").
    """
    todas = modulo_areas.listar_areas(almacen)
    if not slug_area:
        return todas
    elegida = modulo_areas.cargar_area(almacen, slug_area)
    if elegida is None:
        return []
    return [area for area in todas if modulo_areas.es_de_la_rama(area, elegida["nombre"])]


def preguntas_pendientes(almacen, hoy, slug_area=None):
    """Lista de preguntas que tocan hoy, en el orden en que te las vamos a mostrar.

    Si slug_area viene, solo se incluyen las de esa área (y sus subáreas).
    """
    pendientes = []
    for area in _areas_a_considerar(almacen, slug_area):
        for tema in area["temas"]:
            for pregunta in tema["preguntas"]:
                if repaso.esta_pendiente(pregunta, hoy):
                    pendientes.append(
                        {
                            "area_slug": area["slug"],
                            "area_nombre": area["nombre"],
                            "tema": tema,
                            "pregunta": pregunta,
                        }
                    )
    pendientes.sort(key=_orden_de_repaso)
    return pendientes


def _orden_de_repaso(item):
    """Primero las más atrasadas; a igual fecha, primero las que hace más que no ves.

    Por eso una pregunta que acabás de fallar queda al final de la fila de hoy.
    """
    pregunta = item["pregunta"]
    return (pregunta["proxima"], pregunta["ultima_vez"] or "")


def siguiente_pregunta(almacen, hoy, slug_area=None):
    """Devuelve (item, cuantas_quedan). item es None si no hay nada pendiente."""
    pendientes = preguntas_pendientes(almacen, hoy, slug_area)
    if not pendientes:
        return None, 0
    return pendientes[0], len(pendientes)


def responder(almacen, slug_area, id_pregunta, me_acorde, ahora=None):
    """Guarda si te acordaste o no y programa el próximo repaso.

    Devuelve la fecha del próximo repaso. Falla con ValueError si no encuentra la pregunta.
    """
    ahora = ahora or datetime.now()
    hoy = ahora.date()

    # El candado hace que leer-cambiar-guardar sea una sola operación sin interrupciones
    with almacen.candado:
        area = modulo_areas.cargar_area(almacen, slug_area)
        if area is not None:
            for tema in area["temas"]:
                for pregunta in tema["preguntas"]:
                    if pregunta["id"] == id_pregunta:
                        nivel, proxima = repaso.calcular_proximo_repaso(pregunta["nivel"], me_acorde, hoy)
                        pregunta["nivel"] = nivel
                        pregunta["proxima"] = proxima.isoformat()
                        pregunta["ultima_vez"] = ahora.isoformat(timespec="seconds")
                        modulo_areas.guardar_area(almacen, area)
                        return proxima
    raise ValueError("No encontré esa pregunta. Puede que el archivo haya cambiado.")


def tarjetas_de_areas(almacen, hoy):
    """Datos resumidos de cada área para mostrar como tarjetas, en una lista plana.

    Los números de cada área INCLUYEN a sus subáreas: la tarjeta "Programación" suma
    lo de "Programación > CS50". Cada tarjeta trae:
      nombre            nombre completo ("Programación > CS50")
      titulo            cómo mostrarla ("CS50" si se muestra dentro de su padre)
      padre_nombre      nombre completo del padre ("" si es de primer nivel)
      es_raiz           True si va en la lista principal (no tiene padre existente)
      cantidad_subareas subáreas directas
    """
    todas = modulo_areas.listar_areas(almacen)
    nombres_existentes = {area["nombre"].casefold() for area in todas}

    tarjetas = []
    for area in todas:
        rama = [otra for otra in todas if modulo_areas.es_de_la_rama(otra, area["nombre"])]
        preguntas = [p for otra in rama for tema in otra["temas"] for p in tema["preguntas"]]
        pendientes = [p for p in preguntas if repaso.esta_pendiente(p, hoy)]
        temas = sum(len(otra["temas"]) for otra in rama)

        partes = modulo_areas.partir_ruta(area["nombre"])
        padre_nombre = modulo_areas.unir_ruta(partes[:-1])
        padre_existe = padre_nombre.casefold() in nombres_existentes
        tarjetas.append(
            {
                "slug": area["slug"],
                "nombre": area["nombre"],
                # Si el padre no existe (por ejemplo, borraste su archivo a mano), la subárea
                # se muestra en la lista principal con su nombre completo para no perderla.
                "titulo": partes[-1] if (not padre_nombre or padre_existe) else area["nombre"],
                "padre_nombre": padre_nombre,
                "es_raiz": (not padre_nombre) or (not padre_existe),
                "cantidad_subareas": 0,  # se completa abajo
                "cantidad_temas": temas,
                "cantidad_preguntas": len(preguntas),
                "cantidad_pendientes": len(pendientes),
            }
        )

    # Segunda pasada: contar las subáreas directas de cada una
    for tarjeta in tarjetas:
        for otra in tarjetas:
            if otra["padre_nombre"] and otra["padre_nombre"].casefold() == tarjeta["nombre"].casefold():
                tarjeta["cantidad_subareas"] += 1

    return tarjetas


def proxima_fecha_futura(almacen, hoy, slug_area=None):
    """La fecha más cercana en que vuelve a tocar algo (o None si no hay nada programado)."""
    futuras = []
    for area in _areas_a_considerar(almacen, slug_area):
        for tema in area["temas"]:
            for pregunta in tema["preguntas"]:
                fecha = date.fromisoformat(pregunta["proxima"])
                if fecha > hoy:
                    futuras.append(fecha)
    return min(futuras) if futuras else None
