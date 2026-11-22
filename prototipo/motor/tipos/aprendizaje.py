"""El tipo de bloque "aprendizaje": un tema nuevo con su resumen y sus preguntas.

Formato esperado:
{
  "tipo": "aprendizaje",
  "fecha": "2026-11-14",
  "area": "CS50",            (o una subárea: "Programación > CS50")
  "tema": "Punteros",
  "resumen": "Un puntero guarda la dirección de memoria de otra variable.",
  "preguntas": [ {"p": "¿Qué es un puntero?", "r": "Una dirección de memoria", "pista": "opcional"} ]
}

Cada tipo de bloque expone cuatro cosas: NOMBRE, validar, describir y guardar.
"""

import re
from datetime import date

from motor import areas
from motor.errores import ErrorDeImportacion

NOMBRE = "aprendizaje"


def validar(bloque):
    """Revisa el bloque. Si está bien, devuelve una versión limpia.

    Si hay problemas, levanta ErrorDeImportacion con TODOS los mensajes juntos
    (así corregís todo de una vez en lugar de ir de a un error).
    """
    errores = []

    fecha = _texto_obligatorio(bloque, "fecha", errores)
    area = _texto_obligatorio(bloque, "area", errores)
    tema = _texto_obligatorio(bloque, "tema", errores)
    resumen = _texto_obligatorio(bloque, "resumen", errores)

    if fecha:
        fecha = _validar_fecha(fecha, errores)

    if area:
        # Deja el nombre en su forma canónica: "Programación>CS50" -> "Programación > CS50"
        try:
            area = areas.validar_nombre(area)
        except ValueError as error:
            errores.append(f'Campo "area": {error}')
            area = ""

    preguntas = _validar_preguntas(bloque.get("preguntas"), errores)

    if errores:
        raise ErrorDeImportacion(errores)

    # Devolvemos solo los campos conocidos y con espacios sobrantes quitados.
    # Así dos bloques iguales en contenido dan siempre la misma "huella".
    return {
        "tipo": NOMBRE,
        "fecha": fecha,
        "area": area,
        "tema": tema,
        "resumen": resumen,
        "preguntas": preguntas,
    }


def describir(almacen, limpio):
    """Explica en palabras qué se va a guardar (se muestra antes de confirmar)."""
    existente = areas.buscar_area_existente(almacen, limpio["area"])
    if existente:
        linea_area = f'Área: {existente["nombre"]} (ya existe)'
    else:
        linea_area = f'Área: {limpio["area"]} (se va a crear)'
        padres = areas.padres_que_faltan(almacen, limpio["area"])
        if padres:
            # Ejemplo: al crear "Programación > CS50" también se crea "Programación"
            linea_area += " junto con: " + ", ".join(padres)

    cantidad = len(limpio["preguntas"])
    return {
        "titulo": f'Aprendizaje: {limpio["tema"]}',
        "lineas": [
            linea_area,
            f'Fecha: {limpio["fecha"]}',
            f'{cantidad} pregunta' + ("" if cantidad == 1 else "s") + " para repasar desde hoy",
        ],
        "texto": limpio["resumen"],
        "elementos_titulo": "Preguntas",
        "elementos": [pregunta["p"] for pregunta in limpio["preguntas"]],
    }


def guardar(almacen, limpio, huella, hoy):
    """Agrega el tema al área (creándola si hace falta) y guarda el archivo."""
    area = areas.buscar_o_crear_area(almacen, limpio["area"], hoy)

    # El id del tema sale de la huella: es siempre el mismo para el mismo contenido
    id_tema = huella[:10]
    preguntas = []
    for numero, pregunta in enumerate(limpio["preguntas"], start=1):
        preguntas.append(
            {
                "id": f"{id_tema}-{numero}",
                "p": pregunta["p"],
                "r": pregunta["r"],
                "pista": pregunta["pista"],
                "nivel": 0,  # 0 = todavía no la repasaste
                "proxima": hoy.isoformat(),  # la primera vez toca hoy mismo
                "ultima_vez": None,
            }
        )

    area["temas"].append(
        {
            "id": id_tema,
            "fecha": limpio["fecha"],
            "tema": limpio["tema"],
            "resumen": limpio["resumen"],
            "preguntas": preguntas,
        }
    )
    areas.guardar_area(almacen, area)
    return area["slug"]


# ---------- Funciones de ayuda (empiezan con _ porque solo se usan acá) ----------


def _texto_obligatorio(datos, campo, errores):
    """Devuelve el texto del campo sin espacios sobrantes; si hay problema, anota el error."""
    valor = datos.get(campo)
    if valor is None:
        errores.append(f'Falta el campo "{campo}".')
        return ""
    if not isinstance(valor, str):
        errores.append(f'El campo "{campo}" tiene que ser texto (entre comillas).')
        return ""
    valor = valor.strip()
    if not valor:
        errores.append(f'El campo "{campo}" está vacío.')
    return valor


def _validar_fecha(texto, errores):
    # Pedimos exactamente AAAA-MM-DD; date.fromisoformat solo confirma que el día exista
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", texto):
        errores.append(f'La fecha "{texto}" no tiene el formato AAAA-MM-DD (ejemplo: 2026-11-14).')
        return ""
    try:
        return date.fromisoformat(texto).isoformat()
    except ValueError:
        errores.append(f'La fecha "{texto}" no existe en el calendario.')
        return ""


def _validar_preguntas(preguntas, errores):
    if preguntas is None:
        errores.append('Falta el campo "preguntas".')
        return []
    if not isinstance(preguntas, list):
        errores.append('El campo "preguntas" tiene que ser una lista: [ {...}, {...} ].')
        return []
    if not preguntas:
        errores.append('La lista "preguntas" está vacía: hace falta al menos una.')
        return []

    limpias = []
    for numero, pregunta in enumerate(preguntas, start=1):
        if not isinstance(pregunta, dict):
            errores.append(f"La pregunta {numero} tiene que ser un bloque con p, r y pista.")
            continue

        # Reusamos _texto_obligatorio, pero con un mensaje que nombra el número de pregunta
        errores_de_esta = []
        texto_p = _texto_obligatorio(pregunta, "p", errores_de_esta)
        texto_r = _texto_obligatorio(pregunta, "r", errores_de_esta)
        for mensaje in errores_de_esta:
            errores.append(f"Pregunta {numero}: {mensaje}")

        # La pista es opcional: si no viene, queda vacía
        pista = pregunta.get("pista")
        if pista is None:
            pista = ""
        elif not isinstance(pista, str):
            errores.append(f'Pregunta {numero}: la "pista" tiene que ser texto.')
            pista = ""

        limpias.append({"p": texto_p, "r": texto_r, "pista": pista.strip()})

    return limpias
