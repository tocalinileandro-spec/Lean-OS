"""Importar bloques JSON pegados: validar, mostrar qué se guardará y guardar.

Este archivo no sabe nada de cada tipo en particular ("aprendizaje", "tareas"...).
Mira el campo "tipo" y le pasa el trabajo al módulo correspondiente de tipos/.
"""

import hashlib
import json
import re
from datetime import date

from motor.almacen import ARCHIVO_HUELLAS
from motor.errores import ErrorDeImportacion
from motor.tipos import TIPOS


def leer_texto_pegado(texto):
    """Convierte el texto pegado en un diccionario de Python."""
    texto = (texto or "").strip()

    # Muchas herramientas devuelven el JSON dentro de ```json ... ```; lo toleramos
    texto = re.sub(r"^```[a-zA-Z]*\s*", "", texto)
    texto = re.sub(r"\s*```$", "", texto)

    if not texto:
        raise ErrorDeImportacion("No pegaste nada todavía.")

    try:
        bloque = json.loads(texto)
    except json.JSONDecodeError as error:
        raise ErrorDeImportacion(
            f"Esto no es un JSON válido: {error.msg} (línea {error.lineno}, columna {error.colno}). "
            "Revisá que estén todas las comillas, comas y llaves."
        )

    if not isinstance(bloque, dict):
        raise ErrorDeImportacion("El JSON tiene que ser un bloque entre llaves { ... }.")
    return bloque


def calcular_huella(bloque_limpio):
    """Un código único para el CONTENIDO del bloque.

    Mismo contenido (aunque cambien los espacios o el orden de los campos) = misma huella.
    sort_keys=True ordena los campos para que el orden no importe.
    """
    texto = json.dumps(bloque_limpio, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def revisar(almacen, texto):
    """Valida el texto y arma el resumen de lo que se guardaría. NO guarda nada.

    Levanta ErrorDeImportacion si hay algún problema.
    """
    bloque = leer_texto_pegado(texto)

    tipo = bloque.get("tipo")
    if tipo not in TIPOS:
        disponibles = ", ".join(f'"{nombre}"' for nombre in TIPOS)
        raise ErrorDeImportacion(
            f'El campo "tipo" es {json.dumps(tipo, ensure_ascii=False)}, que no conozco. '
            f"Los tipos disponibles son: {disponibles}."
        )

    modulo = TIPOS[tipo]
    limpio = modulo.validar(bloque)
    huella = calcular_huella(limpio)
    huellas = almacen.leer_json(ARCHIVO_HUELLAS, {})

    return {
        "tipo": tipo,
        "limpio": limpio,  # la versión ya validada; "guardar" la usa
        "huella": huella,
        "duplicado": huella in huellas,
        "vista": modulo.describir(almacen, limpio),
    }


def guardar(almacen, texto, hoy=None):
    """Valida de nuevo y guarda. Devuelve un diccionario con el resultado.

    Validamos otra vez (aunque ya se hizo en "revisar") para no confiar en lo que
    llega de la pantalla: el motor se protege solo.
    """
    hoy = hoy or date.today()
    revision = revisar(almacen, texto)

    if revision["duplicado"]:
        return {"guardado": False, "motivo": "duplicado", "vista": revision["vista"]}

    modulo = TIPOS[revision["tipo"]]
    limpio = revision["limpio"]

    with almacen.candado:
        # Re-chequeamos adentro del candado por si otro pedido guardó lo mismo justo ahora
        huellas = almacen.leer_json(ARCHIVO_HUELLAS, {})
        if revision["huella"] in huellas:
            return {"guardado": False, "motivo": "duplicado", "vista": revision["vista"]}

        slug = modulo.guardar(almacen, limpio, revision["huella"], hoy)
        huellas[revision["huella"]] = {"tipo": revision["tipo"], "importado": hoy.isoformat()}
        almacen.escribir_json(ARCHIVO_HUELLAS, huellas)

    return {"guardado": True, "slug_area": slug, "vista": revision["vista"]}
