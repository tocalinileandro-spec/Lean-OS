"""Genera pruebas/fixtures/respaldo-original.zip con el código REAL del prototipo (motor/).

Uso (desde la raíz del repo, Python 3, sin Flask):
    python3 pruebas/fixtures/generar-respaldo-original.py

Arma una carpeta de datos con áreas, subáreas y un tercer nivel, importa bloques con
motor.importar.guardar, simula repasos (niveles 0 a 5 y distintas `proxima`) editando
los JSON de área como lo hace el original, y exporta con motor.respaldo.exportar_todo.
"""
import io
import json
import sys
import tempfile
import zipfile
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "prototipo"))

from motor.almacen import Almacen  # noqa: E402
from motor.areas import crear_area_vacia  # noqa: E402
from motor.importar import guardar  # noqa: E402
from motor.respaldo import exportar_todo  # noqa: E402

HOY = date(2026, 11, 22)


def bloque(area, tema, fecha, resumen, preguntas):
    return json.dumps({"tipo": "aprendizaje", "fecha": fecha, "area": area, "tema": tema,
                       "resumen": resumen,
                       "preguntas": [{"p": p, "r": r, "pista": pista} for p, r, pista in preguntas]},
                      ensure_ascii=False)


with tempfile.TemporaryDirectory() as tmp:
    almacen = Almacen(tmp)
    guardar(almacen, bloque("Programación > CS50", "Punteros en C", "2026-11-14",
            "Un puntero guarda la dirección de memoria de otra variable.",
            [("¿Qué guarda un puntero?", "La dirección de memoria de otra variable.", "Una dirección postal."),
             ("¿Qué operador devuelve la dirección?", "El operador &.", ""),
             ("¿Para qué sirve el * en un puntero declarado?", "Para desreferenciar.", "Ir a la casa.")]), HOY)
    guardar(almacen, bloque("Programación > CS50", "Funciones", "2026-11-15",
            "Una función agrupa código reutilizable.",
            [("¿Qué hace return?", "Devuelve un valor y termina la función.", "")]), HOY)
    guardar(almacen, bloque("Programación > Python > Decoradores", "Decoradores básicos", "2026-11-16",
            "Un decorador envuelve una función.",
            [("¿Qué es un decorador?", "Una función que recibe otra función.", "Envoltorio.")]), HOY)
    guardar(almacen, bloque("Idiomas > Inglés", "Vocabulario de viaje", "2026-11-17",
            "Palabras útiles para viajar.",
            [(f"¿Cómo se dice «{w}» en inglés?", r, "") for w, r in
             [("aeropuerto", "airport"), ("habitación", "room"), ("equipaje", "luggage"),
              ("pasaporte", "passport"), ("boleto", "ticket"), ("ventanilla", "window seat")]]), HOY)
    crear_area_vacia(almacen, "Historia", HOY)

    # Simulamos repasos: el original guarda nivel, proxima y ultima_vez en cada pregunta.
    ruta = Path(tmp) / "areas" / "idiomas-ingles.json"
    area = json.loads(ruta.read_text(encoding="utf-8"))
    proximas = ["2026-11-22", "2026-11-23", "2026-11-25", "2026-12-13", "2027-01-21", "2027-01-22"]
    for nivel, (pregunta, prox) in enumerate(zip(area["temas"][0]["preguntas"], proximas)):
        pregunta["nivel"] = nivel
        pregunta["proxima"] = prox
        pregunta["ultima_vez"] = None if nivel == 0 else f"2026-11-2{nivel}T12:00:00+00:00"
    ruta.write_text(json.dumps(area, ensure_ascii=False, indent=2), encoding="utf-8")

    # Una carpeta papelera/ con un área eliminada: la migración debe ignorarla.
    papelera = Path(tmp) / "papelera"
    papelera.mkdir()
    (papelera / "vieja.json").write_text(
        json.dumps({"slug": "vieja", "nombre": "Vieja", "creada": "2026-01-01", "temas": []}), encoding="utf-8")

    datos = exportar_todo(almacen)

# ZIP reproducible: mismas fechas fijas en cada entrada (el contenido sale de arriba).
salida = io.BytesIO()
with zipfile.ZipFile(io.BytesIO(datos)) as origen, zipfile.ZipFile(salida, "w", zipfile.ZIP_DEFLATED) as destino:
    for info in sorted(origen.infolist(), key=lambda i: i.filename):
        nueva = zipfile.ZipInfo(info.filename, date_time=(2026, 11, 22, 12, 0, 0))
        nueva.compress_type = zipfile.ZIP_DEFLATED
        destino.writestr(nueva, origen.read(info.filename))
(RAIZ / "pruebas" / "fixtures" / "respaldo-original.zip").write_bytes(salida.getvalue())
print("listo:", sorted(zipfile.ZipFile(io.BytesIO(salida.getvalue())).namelist()))
