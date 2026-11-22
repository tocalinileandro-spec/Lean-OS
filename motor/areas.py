"""Áreas (CS50, Lean Startup...), sus subáreas y sus temas.

Cada área vive en su propio archivo: datos/areas/<nombre-corto>.json
Adentro del archivo están sus temas, y adentro de cada tema sus preguntas.

SUBÁREAS: se expresan en el propio nombre con " > ".
    "Programación"           -> área
    "Programación > CS50"    -> subárea de Programación
Así no hace falta ningún campo extra: el nombre completo ya dice dónde está cada una.
Cada nivel es un área real con su propio archivo (los padres se crean solos).
"""

import os
import re
import unicodedata
from datetime import datetime

from motor.almacen import ARCHIVO_HUELLAS

SEPARADOR = " > "
LARGO_MAXIMO_DE_UNA_PARTE = 60  # "Programación" o "CS50"
LARGO_MAXIMO_DEL_NOMBRE_COMPLETO = 150  # "Programación > CS50"


# ---------- Nombres y rutas ----------


def partir_ruta(nombre):
    """"Programación > CS50" -> ["Programación", "CS50"] (sin espacios de más ni partes vacías)."""
    partes = []
    for pedazo in (nombre or "").split(">"):
        pedazo = " ".join(pedazo.split())
        if pedazo:
            partes.append(pedazo)
    return partes


def unir_ruta(partes):
    """["Programación", "CS50"] -> "Programación > CS50" """
    return SEPARADOR.join(partes)


def validar_nombre(nombre):
    """Devuelve el nombre en su forma canónica ("A>B" -> "A > B") o falla con ValueError."""
    partes = partir_ruta(nombre)
    if not partes:
        raise ValueError("El nombre del área está vacío.")
    for parte in partes:
        if len(parte) > LARGO_MAXIMO_DE_UNA_PARTE:
            raise ValueError(f"Cada parte del nombre puede tener hasta {LARGO_MAXIMO_DE_UNA_PARTE} letras.")
    completo = unir_ruta(partes)
    if len(completo) > LARGO_MAXIMO_DEL_NOMBRE_COMPLETO:
        raise ValueError(f"El nombre completo es demasiado largo (máximo {LARGO_MAXIMO_DEL_NOMBRE_COMPLETO} letras).")
    return completo


def crear_slug(nombre):
    """Convierte "Lean Startup" en "lean-startup" para usarlo como nombre de archivo.

    Sacamos tildes y símbolos porque los nombres de archivo con caracteres raros
    dan problemas al sincronizar con la nube.
    """
    sin_tildes = unicodedata.normalize("NFKD", nombre)
    sin_tildes = "".join(letra for letra in sin_tildes if not unicodedata.combining(letra))
    slug = re.sub(r"[^a-z0-9]+", "-", sin_tildes.lower()).strip("-")
    return slug or "area"


def es_de_la_rama(area, nombre_raiz):
    """True si el área ES esa raíz o está por debajo de ella (subárea, sub-subárea...)."""
    nombre = area["nombre"].casefold()
    raiz = nombre_raiz.casefold()
    return nombre == raiz or nombre.startswith(raiz + SEPARADOR.casefold())


# ---------- Leer y guardar ----------


def listar_areas(almacen):
    """Todas las áreas, ordenadas por nombre (cada padre justo antes de sus subáreas)."""
    areas = []
    for ruta in (almacen.carpeta / "areas").glob("*.json"):
        area = almacen.leer_json(f"areas/{ruta.name}", None)
        # Si en la carpeta aparece un archivo que no es un área (por ejemplo, algo que dejó
        # la sincronización de la nube), lo ignoramos y avisamos, en vez de romper todo.
        if not _parece_un_area(area):
            print(f"Aviso: ignoro areas/{ruta.name}, no tiene formato de área.")
            continue
        areas.append(area)
    areas.sort(key=_clave_para_ordenar)
    return areas


def _parece_un_area(dato):
    """True si el dato tiene los campos mínimos de un área."""
    return isinstance(dato, dict) and all(campo in dato for campo in ("slug", "nombre", "temas"))


def _clave_para_ordenar(area):
    # Ordenamos parte por parte, así "Programación" queda antes que "Programación > CS50"
    return [parte.casefold() for parte in partir_ruta(area["nombre"])]


def cargar_area(almacen, slug):
    """Devuelve el área con ese slug, o None si no existe."""
    # Solo aceptamos letras minúsculas, números y guiones. Esto evita que alguien
    # (o un error) use algo como "../../otra-cosa" para salirse de la carpeta de datos.
    if not re.fullmatch(r"[a-z0-9-]+", slug or ""):
        return None
    return almacen.leer_json(f"areas/{slug}.json", None)


def guardar_area(almacen, area):
    almacen.escribir_json(f"areas/{area['slug']}.json", area)


def buscar_area_existente(almacen, nombre):
    """Busca un área por su nombre completo, sin importar mayúsculas. None si no existe."""
    nombre = unir_ruta(partir_ruta(nombre)).casefold()
    for area in listar_areas(almacen):
        if area["nombre"].casefold() == nombre:
            return area
    return None


def padres_que_faltan(almacen, nombre):
    """Los nombres de los "padres" de esta ruta que todavía no existen como área."""
    partes = partir_ruta(nombre)
    faltan = []
    for cantidad in range(1, len(partes)):
        nombre_padre = unir_ruta(partes[:cantidad])
        if buscar_area_existente(almacen, nombre_padre) is None:
            faltan.append(nombre_padre)
    return faltan


def buscar_o_crear_area(almacen, nombre, hoy):
    """Devuelve el área; si no existe, arma una nueva (todavía sin guardar en disco).

    Los padres que falten ("Programación" para "Programación > CS50") sí se crean y se
    guardan acá mismo, para que la subárea nunca quede "colgando" de algo que no existe.
    """
    for nombre_padre in padres_que_faltan(almacen, nombre):
        guardar_area(almacen, _area_nueva(almacen, nombre_padre, hoy))

    existente = buscar_area_existente(almacen, nombre)
    if existente:
        return existente
    return _area_nueva(almacen, unir_ruta(partir_ruta(nombre)), hoy)


def _area_nueva(almacen, nombre, hoy):
    base = crear_slug(nombre)
    slug = base
    numero = 1
    # Dos nombres distintos podrían dar el mismo slug ("C++" y "C#"); si pasa, numeramos
    while (almacen.carpeta / "areas" / f"{slug}.json").exists():
        numero += 1
        slug = f"{base}-{numero}"
    return {"slug": slug, "nombre": nombre, "creada": hoy.isoformat(), "temas": []}


def crear_area_vacia(almacen, nombre, hoy):
    """Crea y guarda un área (o subárea) sin temas.

    Falla con ValueError y un mensaje claro si el nombre no sirve o ya existe.
    """
    nombre = validar_nombre(nombre)

    with almacen.candado:
        if buscar_area_existente(almacen, nombre):
            raise ValueError(f'Ya existe un área llamada "{nombre}".')
        area = buscar_o_crear_area(almacen, nombre, hoy)
        guardar_area(almacen, area)
    return area


# ---------- Árbol: subáreas ----------


def rama_de(almacen, area):
    """El área y todas sus subáreas, empezando por el área misma."""
    return [otra for otra in listar_areas(almacen) if es_de_la_rama(otra, area["nombre"])]


def ancestros_de(almacen, area):
    """Los padres que existen, del más alto al más cercano. Sirve para el "camino" de la pantalla."""
    partes = partir_ruta(area["nombre"])
    ancestros = []
    for cantidad in range(1, len(partes)):
        padre = buscar_area_existente(almacen, unir_ruta(partes[:cantidad]))
        if padre:
            ancestros.append(padre)
    return ancestros


def eliminar_area(almacen, slug, ahora=None):
    """Elimina un área CON todas sus subáreas, temas y preguntas.

    Devuelve la lista de áreas eliminadas; la primera es la que pediste eliminar.
    No las borra del disco: mueve sus archivos a la carpeta "papelera" (dentro de tus datos),
    así, si te arrepentís, podés recuperarlas copiando los archivos de vuelta a "areas".
    """
    ahora = ahora or datetime.now()

    with almacen.candado:
        area = cargar_area(almacen, slug)
        if area is None:
            raise ValueError("No encontré esa área. Puede que ya la hayas eliminado.")

        rama = rama_de(almacen, area)
        marca_de_tiempo = ahora.strftime("%Y%m%d-%H%M%S")
        (almacen.carpeta / "papelera").mkdir(parents=True, exist_ok=True)

        for eliminada in rama:
            origen = almacen.carpeta / "areas" / f"{eliminada['slug']}.json"
            destino = almacen.carpeta / "papelera" / f"{eliminada['slug']}-{marca_de_tiempo}.json"
            os.replace(origen, destino)
            olvidar_huellas_de_los_temas(almacen, eliminada)
    return rama


def olvidar_huellas_de_los_temas(almacen, area):
    """Saca de importados.json las huellas de los temas del área (o de cualquier dato con "temas").

    Si no lo hiciéramos, al volver a pegar el mismo bloque la app diría "ya lo importaste"
    y no lo guardaría, aunque el área ya no exista.
    """
    # El id de cada tema son los primeros 10 caracteres de la huella de su bloque
    ids_de_temas = [tema["id"] for tema in area["temas"]]

    huellas = almacen.leer_json(ARCHIVO_HUELLAS, {})
    huellas_que_quedan = {}
    for huella, datos in huellas.items():
        if huella[:10] not in ids_de_temas:
            huellas_que_quedan[huella] = datos

    if len(huellas_que_quedan) != len(huellas):
        almacen.escribir_json(ARCHIVO_HUELLAS, huellas_que_quedan)


# ---------- Temas ----------


def temas_ordenados(area):
    """Los temas del área, del más nuevo al más viejo."""
    return sorted(area["temas"], key=_fecha_del_tema, reverse=True)


def _fecha_del_tema(tema):
    return tema["fecha"]
