"""Pruebas del motor. Se ejecutan con:  python -m unittest discover -s pruebas -t .

Cada prueba usa una carpeta temporal, así que nunca toca tus datos reales.
"""

import json
import os
import time
import tempfile
import unittest
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

from motor import areas, estudio, importar, repaso, respaldo, temas
from motor.almacen import Almacen
from motor.errores import ErrorDeImportacion

HOY = date(2026, 11, 15)

BLOQUE = {
    "tipo": "aprendizaje",
    "fecha": "2026-11-14",
    "area": "CS50",
    "tema": "Punteros",
    "resumen": "Un puntero guarda una dirección.",
    "preguntas": [
        {"p": "¿Qué es un puntero?", "r": "Una dirección", "pista": "casa vs dirección"},
        {"p": "¿Qué hace &?", "r": "Da la dirección"},  # sin pista: es opcional
    ],
}


def como_texto(bloque):
    return json.dumps(bloque, ensure_ascii=False)


class PruebaConCarpetaTemporal(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory()
        self.almacen = Almacen(Path(self.temporal.name))

    def tearDown(self):
        self.temporal.cleanup()


class PruebasDeRepaso(unittest.TestCase):
    def test_los_intervalos_suben_1_3_7_21_60(self):
        nivel = 0
        dias = []
        for _ in range(5):
            nivel, proxima = repaso.calcular_proximo_repaso(nivel, True, HOY)
            dias.append((proxima - HOY).days)
        self.assertEqual(dias, [1, 3, 7, 21, 60])

    def test_el_ultimo_intervalo_se_repite(self):
        nivel, proxima = repaso.calcular_proximo_repaso(5, True, HOY)
        self.assertEqual(nivel, 5)
        self.assertEqual(proxima, HOY + timedelta(days=60))

    def test_olvidar_vuelve_al_nivel_cero_y_para_hoy(self):
        nivel, proxima = repaso.calcular_proximo_repaso(4, False, HOY)
        self.assertEqual(nivel, 0)
        self.assertEqual(proxima, HOY)


class PruebasDeImportar(PruebaConCarpetaTemporal):
    def test_importa_y_crea_el_area(self):
        resultado = importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        self.assertTrue(resultado["guardado"])
        area = areas.cargar_area(self.almacen, "cs50")
        self.assertEqual(area["nombre"], "CS50")
        self.assertEqual(len(area["temas"][0]["preguntas"]), 2)
        self.assertEqual(area["temas"][0]["preguntas"][1]["pista"], "")

    def test_pegar_dos_veces_no_duplica(self):
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        segundo = importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        self.assertFalse(segundo["guardado"])
        self.assertEqual(len(areas.cargar_area(self.almacen, "cs50")["temas"]), 1)

    def test_mismo_contenido_con_otro_formato_tambien_es_duplicado(self):
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        # Otro orden de campos, espacios de más y bloque de código con ```
        distinto = dict(reversed(list(BLOQUE.items())))
        distinto["tema"] = "  Punteros  "
        texto = "```json\n" + json.dumps(distinto, indent=4, ensure_ascii=False) + "\n```"
        self.assertTrue(importar.revisar(self.almacen, texto)["duplicado"])

    def test_el_area_se_busca_sin_importar_mayusculas(self):
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        otro = dict(BLOQUE, area="cs50", tema="Memoria")
        importar.guardar(self.almacen, como_texto(otro), HOY)
        self.assertEqual(len(areas.listar_areas(self.almacen)), 1)
        self.assertEqual(len(areas.cargar_area(self.almacen, "cs50")["temas"]), 2)

    def test_revisar_no_guarda_nada(self):
        importar.revisar(self.almacen, como_texto(BLOQUE))
        self.assertEqual(areas.listar_areas(self.almacen), [])

    def test_errores_claros(self):
        casos = {
            "": "No pegaste nada",
            "{esto no es json": "no es un JSON válido",
            "[1, 2]": "entre llaves",
            '{"tipo": "otra-cosa"}': "no conozco",
        }
        for texto, esperado in casos.items():
            with self.assertRaises(ErrorDeImportacion) as contexto:
                importar.revisar(self.almacen, texto)
            self.assertIn(esperado, contexto.exception.mensajes[0])

    def test_junta_todos_los_errores_del_bloque(self):
        malo = {"tipo": "aprendizaje", "fecha": "14/11/2026", "area": "", "preguntas": [{"p": "Hola"}]}
        with self.assertRaises(ErrorDeImportacion) as contexto:
            importar.revisar(self.almacen, como_texto(malo))
        mensajes = " | ".join(contexto.exception.mensajes)
        self.assertIn("AAAA-MM-DD", mensajes)
        self.assertIn('"area" está vacío', mensajes)
        self.assertIn('Falta el campo "tema"', mensajes)
        self.assertIn('Pregunta 1: Falta el campo "r"', mensajes)

    def test_fecha_inexistente(self):
        with self.assertRaises(ErrorDeImportacion):
            importar.revisar(self.almacen, como_texto(dict(BLOQUE, fecha="2026-02-31")))


class PruebasDeAreasVacias(PruebaConCarpetaTemporal):
    def test_crear_area_vacia_y_despues_importar_en_ella(self):
        area = areas.crear_area_vacia(self.almacen, "  Python  ", HOY)
        self.assertEqual(area["nombre"], "Python")
        self.assertEqual(areas.cargar_area(self.almacen, "python")["temas"], [])

        importar.guardar(self.almacen, como_texto(dict(BLOQUE, area="python")), HOY)
        self.assertEqual(len(areas.listar_areas(self.almacen)), 1)  # no se creó otra
        self.assertEqual(len(areas.cargar_area(self.almacen, "python")["temas"]), 1)

    def test_nombres_invalidos(self):
        areas.crear_area_vacia(self.almacen, "Python", HOY)
        for nombre, esperado in [("   ", "está vacío"), ("PYTHON", "Ya existe"), ("x" * 61, "hasta 60 letras")]:
            with self.assertRaises(ValueError) as contexto:
                areas.crear_area_vacia(self.almacen, nombre, HOY)
            self.assertIn(esperado, str(contexto.exception))


class PruebasDeEliminarArea(PruebaConCarpetaTemporal):
    def setUp(self):
        super().setUp()
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        importar.guardar(self.almacen, como_texto(dict(BLOQUE, area="Lean Startup", tema="MVP")), HOY)

    def test_elimina_solo_esa_area_y_la_manda_a_la_papelera(self):
        eliminadas = areas.eliminar_area(self.almacen, "cs50", datetime(2026, 11, 15, 20, 0, 0))
        self.assertEqual([a["nombre"] for a in eliminadas], ["CS50"])
        self.assertEqual([a["nombre"] for a in areas.listar_areas(self.almacen)], ["Lean Startup"])
        self.assertTrue((self.almacen.carpeta / "papelera" / "cs50-20261115-200000.json").exists())
        # Las preguntas de esa área ya no aparecen en el repaso
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY)), 2)

    def test_despues_de_eliminar_se_puede_volver_a_importar_lo_mismo(self):
        areas.eliminar_area(self.almacen, "cs50")
        resultado = importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        self.assertTrue(resultado["guardado"])  # no lo toma como duplicado
        self.assertEqual(len(areas.cargar_area(self.almacen, "cs50")["temas"]), 1)

    def test_las_huellas_de_otras_areas_se_conservan(self):
        areas.eliminar_area(self.almacen, "cs50")
        otro = como_texto(dict(BLOQUE, area="Lean Startup", tema="MVP"))
        self.assertTrue(importar.revisar(self.almacen, otro)["duplicado"])

    def test_area_inexistente_o_slug_peligroso(self):
        for slug in ["no-existe", "../importados", ""]:
            with self.assertRaises(ValueError):
                areas.eliminar_area(self.almacen, slug)
        self.assertTrue((self.almacen.carpeta / "importados.json").exists())


class PruebasDeSubareas(PruebaConCarpetaTemporal):
    def importar_en(self, area, tema="Punteros"):
        return importar.guardar(self.almacen, como_texto(dict(BLOQUE, area=area, tema=tema)), HOY)

    def nombres(self):
        return [a["nombre"] for a in areas.listar_areas(self.almacen)]

    def test_importar_en_una_subarea_crea_tambien_al_padre(self):
        self.importar_en("Programación > CS50")
        self.assertEqual(self.nombres(), ["Programación", "Programación > CS50"])
        self.assertEqual(areas.cargar_area(self.almacen, "programacion")["temas"], [])
        self.assertEqual(len(areas.cargar_area(self.almacen, "programacion-cs50")["temas"]), 1)

    def test_la_vista_previa_avisa_que_se_crea_el_padre(self):
        vista = importar.revisar(self.almacen, como_texto(dict(BLOQUE, area="Programación > CS50")))["vista"]
        self.assertIn("junto con: Programación", vista["lineas"][0])

    def test_distinto_espaciado_es_la_misma_subarea_y_el_mismo_bloque(self):
        self.importar_en("Programación > CS50")
        # Solo cambia el espaciado del nombre: es el mismo contenido, o sea, duplicado
        self.assertTrue(importar.revisar(self.almacen, como_texto(dict(BLOQUE, area="Programación>CS50")))["duplicado"])
        # Cambian las mayúsculas y el tema: es contenido nuevo, pero va a la MISMA subárea
        self.importar_en("PROGRAMACIÓN  >  cs50", tema="Memoria")
        self.assertEqual(self.nombres(), ["Programación", "Programación > CS50"])  # no se creó otra

    def test_partes_vacias_se_ignoran(self):
        self.assertEqual(areas.validar_nombre(" A >  > B "), "A > B")
        with self.assertRaises(ValueError):
            areas.validar_nombre(" > ")

    def test_las_tarjetas_suman_las_subareas(self):
        self.importar_en("Programación > CS50")
        self.importar_en("Programación > Python", tema="Listas")
        self.importar_en("Programación", tema="General")
        tarjetas = {t["nombre"]: t for t in estudio.tarjetas_de_areas(self.almacen, HOY)}

        padre = tarjetas["Programación"]
        self.assertTrue(padre["es_raiz"])
        self.assertEqual(padre["cantidad_subareas"], 2)
        self.assertEqual(padre["cantidad_temas"], 3)  # suma los suyos y los de las subáreas
        self.assertEqual(padre["cantidad_preguntas"], 6)

        hija = tarjetas["Programación > CS50"]
        self.assertFalse(hija["es_raiz"])
        self.assertEqual(hija["titulo"], "CS50")
        self.assertEqual(hija["padre_nombre"], "Programación")
        self.assertEqual(hija["cantidad_temas"], 1)

    def test_repasar_el_padre_incluye_las_subareas_pero_no_al_reves(self):
        self.importar_en("Programación > CS50")
        self.importar_en("Programación > Python", tema="Listas")
        self.importar_en("Programación 2", tema="Otra")  # parecido en el nombre, pero NO es una subárea
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY, "programacion")), 4)
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY, "programacion-cs50")), 2)
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY)), 6)

    def test_crear_subarea_vacia_crea_los_padres(self):
        areas.crear_area_vacia(self.almacen, "A > B > C", HOY)
        self.assertEqual(self.nombres(), ["A", "A > B", "A > B > C"])

    def test_eliminar_el_padre_elimina_tambien_las_subareas(self):
        self.importar_en("Programación > CS50")
        self.importar_en("Programación 2", tema="Otra")
        eliminadas = areas.eliminar_area(self.almacen, "programacion")
        self.assertEqual([a["nombre"] for a in eliminadas], ["Programación", "Programación > CS50"])
        self.assertEqual(self.nombres(), ["Programación 2"])  # la parecida no se toca
        self.assertEqual(len(list((self.almacen.carpeta / "papelera").glob("*.json"))), 2)
        # y se puede volver a importar lo mismo
        self.assertTrue(self.importar_en("Programación > CS50")["guardado"])

    def test_eliminar_una_subarea_deja_al_padre(self):
        self.importar_en("Programación > CS50")
        areas.eliminar_area(self.almacen, "programacion-cs50")
        self.assertEqual(self.nombres(), ["Programación"])

    def test_subarea_huerfana_se_muestra_en_la_lista_principal(self):
        self.importar_en("Programación > CS50")
        (self.almacen.carpeta / "areas" / "programacion.json").unlink()  # alguien borró al padre a mano
        tarjeta = estudio.tarjetas_de_areas(self.almacen, HOY)[0]
        self.assertTrue(tarjeta["es_raiz"])
        self.assertEqual(tarjeta["titulo"], "Programación > CS50")

    def test_ancestros(self):
        areas.crear_area_vacia(self.almacen, "A > B > C", HOY)
        hoja = areas.buscar_area_existente(self.almacen, "A > B > C")
        self.assertEqual([a["nombre"] for a in areas.ancestros_de(self.almacen, hoja)], ["A", "A > B"])


class PruebasDeTemas(PruebaConCarpetaTemporal):
    def setUp(self):
        super().setUp()
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)  # CS50 > tema "Punteros"
        areas.crear_area_vacia(self.almacen, "Programación > Python", HOY)
        areas.crear_area_vacia(self.almacen, "Lean Startup", HOY)
        self.id_tema = areas.cargar_area(self.almacen, "cs50")["temas"][0]["id"]

    def temas_de(self, slug):
        return [t["tema"] for t in areas.cargar_area(self.almacen, slug)["temas"]]

    def test_eliminar_tema_lo_saca_y_deja_copia_en_la_papelera(self):
        eliminado = temas.eliminar_tema(self.almacen, "cs50", self.id_tema, datetime(2026, 11, 15, 20, 0, 0))
        self.assertEqual(eliminado["tema"], "Punteros")
        self.assertEqual(self.temas_de("cs50"), [])
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY)), 0)

        copia = self.almacen.leer_json(f"papelera/tema_{self.id_tema}-20261115-200000.json", None)
        self.assertEqual(copia["area"], "CS50")
        self.assertEqual(copia["tema"]["tema"], "Punteros")
        self.assertEqual(len(copia["tema"]["preguntas"]), 2)

    def test_despues_de_eliminar_se_puede_volver_a_importar(self):
        temas.eliminar_tema(self.almacen, "cs50", self.id_tema)
        self.assertTrue(importar.guardar(self.almacen, como_texto(BLOQUE), HOY)["guardado"])

    def test_eliminar_un_tema_no_toca_a_los_otros(self):
        importar.guardar(self.almacen, como_texto(dict(BLOQUE, tema="Memoria")), HOY)
        temas.eliminar_tema(self.almacen, "cs50", self.id_tema)
        self.assertEqual(self.temas_de("cs50"), ["Memoria"])

    def test_mover_a_otra_area_y_a_una_subarea(self):
        temas.mover_tema(self.almacen, "cs50", self.id_tema, "lean-startup")
        self.assertEqual(self.temas_de("cs50"), [])
        self.assertEqual(self.temas_de("lean-startup"), ["Punteros"])

        temas.mover_tema(self.almacen, "lean-startup", self.id_tema, "programacion-python")  # a una subárea
        self.assertEqual(self.temas_de("programacion-python"), ["Punteros"])
        self.assertEqual(self.temas_de("lean-startup"), [])

    def test_mover_conserva_el_progreso_del_repaso(self):
        pregunta = estudio.siguiente_pregunta(self.almacen, HOY)[0]["pregunta"]
        proxima = estudio.responder(self.almacen, "cs50", pregunta["id"], True, datetime(2026, 11, 15, 9, 0))

        temas.mover_tema(self.almacen, "cs50", self.id_tema, "lean-startup")
        movida = [p for p in areas.cargar_area(self.almacen, "lean-startup")["temas"][0]["preguntas"] if p["id"] == pregunta["id"]][0]
        self.assertEqual(movida["nivel"], 1)
        self.assertEqual(movida["proxima"], proxima.isoformat())

    def test_el_repaso_sigue_funcionando_despues_de_mover(self):
        temas.mover_tema(self.almacen, "cs50", self.id_tema, "lean-startup")
        item = estudio.siguiente_pregunta(self.almacen, HOY)[0]
        self.assertEqual(item["area_slug"], "lean-startup")
        estudio.responder(self.almacen, item["area_slug"], item["pregunta"]["id"], True, datetime(2026, 11, 15, 9, 0))

    def test_mover_el_mismo_bloque_ya_importado_sigue_siendo_duplicado(self):
        temas.mover_tema(self.almacen, "cs50", self.id_tema, "lean-startup")
        self.assertTrue(importar.revisar(self.almacen, como_texto(BLOQUE))["duplicado"])

    def test_errores(self):
        casos = [
            lambda: temas.mover_tema(self.almacen, "cs50", self.id_tema, "cs50"),  # mismo lugar
            lambda: temas.mover_tema(self.almacen, "cs50", self.id_tema, "no-existe"),
            lambda: temas.mover_tema(self.almacen, "cs50", "tema-falso", "lean-startup"),
            lambda: temas.mover_tema(self.almacen, "no-existe", self.id_tema, "lean-startup"),
            lambda: temas.eliminar_tema(self.almacen, "cs50", "tema-falso"),
            lambda: temas.eliminar_tema(self.almacen, "../importados", self.id_tema),
        ]
        for caso in casos:
            with self.assertRaises(ValueError):
                caso()
        self.assertEqual(self.temas_de("cs50"), ["Punteros"])  # nada cambió


class PruebasDeEstudio(PruebaConCarpetaTemporal):
    def setUp(self):
        super().setUp()
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)

    def test_lo_nuevo_toca_hoy(self):
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY)), 2)

    def test_acordarse_sube_el_intervalo_y_la_saca_de_hoy(self):
        item, _ = estudio.siguiente_pregunta(self.almacen, HOY)
        ahora = datetime(2026, 11, 15, 10, 0)
        proxima = estudio.responder(self.almacen, "cs50", item["pregunta"]["id"], True, ahora)
        self.assertEqual(proxima, HOY + timedelta(days=1))
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY)), 1)

    def test_olvidar_la_manda_al_final_de_la_fila(self):
        primera, _ = estudio.siguiente_pregunta(self.almacen, HOY)
        estudio.responder(self.almacen, "cs50", primera["pregunta"]["id"], False, datetime(2026, 11, 15, 10, 0))
        segunda, quedan = estudio.siguiente_pregunta(self.almacen, HOY)
        self.assertEqual(quedan, 2)  # la fallida sigue pendiente...
        self.assertNotEqual(segunda["pregunta"]["id"], primera["pregunta"]["id"])  # ...pero ahora va última

    def test_filtrar_por_area(self):
        importar.guardar(self.almacen, como_texto(dict(BLOQUE, area="Lean Startup", tema="MVP")), HOY)
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY)), 4)
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY, "lean-startup")), 2)

    def test_pregunta_inexistente(self):
        with self.assertRaises(ValueError):
            estudio.responder(self.almacen, "cs50", "no-existe", True)

    def test_proxima_fecha_futura(self):
        for item in estudio.preguntas_pendientes(self.almacen, HOY):
            estudio.responder(self.almacen, "cs50", item["pregunta"]["id"], True, datetime(2026, 11, 15, 9, 0))
        self.assertIsNone(estudio.siguiente_pregunta(self.almacen, HOY)[0])
        self.assertEqual(estudio.proxima_fecha_futura(self.almacen, HOY), date(2026, 11, 16))


class PruebasDeRespaldo(PruebaConCarpetaTemporal):
    def test_un_respaldo_por_dia(self):
        self.assertFalse(respaldo.actualizar_respaldo_de_hoy(self.almacen, HOY))  # sin datos: nada
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        self.assertTrue(respaldo.actualizar_respaldo_de_hoy(self.almacen, HOY))
        self.assertFalse(respaldo.actualizar_respaldo_de_hoy(self.almacen, HOY))  # ya existe
        self.assertTrue((self.almacen.carpeta / "respaldos" / "respaldo-2026-11-15.zip").exists())

    def test_el_respaldo_de_hoy_se_renueva_si_cambian_los_datos(self):
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        respaldo.actualizar_respaldo_de_hoy(self.almacen, HOY)
        ruta = self.almacen.carpeta / "respaldos" / "respaldo-2026-11-15.zip"

        # Hacemos "vieja" la fecha del respaldo, como si lo hubieran creado hace un rato
        pasado = time.time() - 100
        os.utime(ruta, (pasado, pasado))

        importar.guardar(self.almacen, como_texto(dict(BLOQUE, tema="Memoria")), HOY)  # dato nuevo
        self.assertTrue(respaldo.actualizar_respaldo_de_hoy(self.almacen, HOY))  # se renueva
        with zipfile.ZipFile(ruta) as paquete:
            area = json.loads(paquete.read("areas/cs50.json"))
        self.assertEqual(len(area["temas"]), 2)  # el respaldo ya trae el tema nuevo

        self.assertFalse(respaldo.actualizar_respaldo_de_hoy(self.almacen, HOY))  # y ahora sí, al día

    def test_conserva_solo_los_ultimos(self):
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        for dia in range(5):
            respaldo.actualizar_respaldo_de_hoy(self.almacen, HOY + timedelta(days=dia), conservar=3)
        nombres = sorted(p.name for p in (self.almacen.carpeta / "respaldos").glob("*.zip"))
        self.assertEqual(nombres, ["respaldo-2026-11-17.zip", "respaldo-2026-11-18.zip", "respaldo-2026-11-19.zip"])

    def test_exportar_todo_no_incluye_los_respaldos(self):
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        respaldo.actualizar_respaldo_de_hoy(self.almacen, HOY)
        ruta = self.almacen.carpeta / "export.zip"
        ruta.write_bytes(respaldo.exportar_todo(self.almacen))
        with zipfile.ZipFile(ruta) as paquete:
            nombres = paquete.namelist()
        self.assertIn("areas/cs50.json", nombres)
        self.assertIn("importados.json", nombres)
        self.assertFalse(any(n.startswith("respaldos") for n in nombres))


class PruebasDeArchivosAjenos(PruebaConCarpetaTemporal):
    def test_un_json_ajeno_en_areas_no_rompe_nada(self):
        importar.guardar(self.almacen, como_texto(BLOQUE), HOY)
        self.almacen.escribir_json("areas/basura.json", {"importante": "no soy un área"})
        self.almacen.escribir_json("areas/lista.json", [1, 2, 3])
        self.assertEqual([a["nombre"] for a in areas.listar_areas(self.almacen)], ["CS50"])
        self.assertEqual(len(estudio.preguntas_pendientes(self.almacen, HOY)), 2)


class PruebasDeSeguridad(PruebaConCarpetaTemporal):
    def test_slug_raro_no_sale_de_la_carpeta(self):
        self.assertIsNone(areas.cargar_area(self.almacen, "../importados"))
        self.assertIsNone(areas.cargar_area(self.almacen, ""))


if __name__ == "__main__":
    unittest.main()
