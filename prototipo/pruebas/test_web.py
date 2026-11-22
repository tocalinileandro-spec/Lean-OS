"""Pruebas de las páginas: recorren la app como si fueran el navegador.

Se ejecutan con:  .venv\\Scripts\\python -m unittest discover -s pruebas -t .
(necesitan Flask, por eso se corren con el Python del entorno .venv)
"""

import json
import tempfile
import unittest
from pathlib import Path

from motor.configuracion import VALORES_POR_DEFECTO
from web.app import crear_aplicacion

BLOQUE = {
    "tipo": "aprendizaje",
    "fecha": "2026-11-14",
    "area": "Lean Startup",
    "tema": "MVP",
    "resumen": "Producto mínimo viable.",
    "preguntas": [{"p": "¿Qué es un MVP?", "r": "La versión mínima para aprender.", "pista": "mínimo"}],
}


class PruebasDeLaWeb(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory()
        configuracion = dict(VALORES_POR_DEFECTO, carpeta_datos=Path(self.temporal.name))
        self.cliente = crear_aplicacion(configuracion).test_client()

    def tearDown(self):
        self.temporal.cleanup()

    def importar(self):
        texto = json.dumps(BLOQUE, ensure_ascii=False)
        return self.cliente.post("/importar/confirmar", data={"texto": texto})

    def test_paginas_vacias_cargan(self):
        for ruta in ["/", "/areas", "/importar", "/repaso", "/exportar"]:
            self.assertEqual(self.cliente.get(ruta).status_code, 200, ruta)
        self.assertIn("Todavía no hay nada", self.cliente.get("/").get_data(as_text=True))

    def test_flujo_completo(self):
        texto = json.dumps(BLOQUE, ensure_ascii=False)

        revision = self.cliente.post("/importar/revisar", data={"texto": texto}).get_data(as_text=True)
        self.assertIn("Confirmar y guardar", revision)
        self.assertIn("se va a crear", revision)

        self.assertIn("Guardado", self.importar().get_data(as_text=True))
        self.assertIn("Lean Startup", self.cliente.get("/areas").get_data(as_text=True))
        self.assertIn("Producto mínimo viable", self.cliente.get("/areas/lean-startup").get_data(as_text=True))

        # Repaso: aparece la pregunta; al responder "me acordé" ya no queda nada para hoy
        pagina = self.cliente.get("/repaso").get_data(as_text=True)
        self.assertIn("¿Qué es un MVP?", pagina)
        id_pregunta = pagina.split('name="id_pregunta" value="')[1].split('"')[0]
        self.cliente.post(
            "/repaso/responder",
            data={"area_slug": "lean-startup", "id_pregunta": id_pregunta, "me_acorde": "si"},
        )
        self.assertIn("No hay nada para repasar", self.cliente.get("/repaso").get_data(as_text=True))

    def test_duplicado_no_se_guarda_dos_veces(self):
        self.importar()
        segundo = self.importar().get_data(as_text=True)
        self.assertIn("No se guardó nada", segundo)

    def test_error_claro_con_json_mal_formado(self):
        pagina = self.cliente.post("/importar/revisar", data={"texto": "{rota"}).get_data(as_text=True)
        self.assertIn("no es un JSON válido", pagina)
        self.assertIn("{rota", pagina)  # el texto pegado se conserva para corregirlo

    def test_crear_area_desde_la_pantalla(self):
        respuesta = self.cliente.post("/areas/nueva", data={"nombre": "Python"})
        self.assertEqual(respuesta.status_code, 302)  # redirige a la página del área
        self.assertIn("Python", self.cliente.get("/areas").get_data(as_text=True))
        self.assertIn("todavía no tiene temas", self.cliente.get("/areas/python").get_data(as_text=True))
        # La importación recuerda los nombres existentes
        self.assertIn("Tus áreas", self.cliente.get("/importar").get_data(as_text=True))

        repetida = self.cliente.post("/areas/nueva", data={"nombre": "python"}).get_data(as_text=True)
        self.assertIn("Ya existe un área", repetida)

    def test_eliminar_area_pide_confirmacion_y_despues_elimina(self):
        self.importar()
        # GET solo pregunta: no elimina nada
        pregunta = self.cliente.get("/areas/lean-startup/eliminar").get_data(as_text=True)
        self.assertIn("1 tema", pregunta)
        self.assertIn("1 pregunta", pregunta)
        self.assertEqual(self.cliente.get("/areas/lean-startup").status_code, 200)

        # POST elimina y vuelve a la lista avisando
        respuesta = self.cliente.post("/areas/lean-startup/eliminar", follow_redirects=True)
        pagina = respuesta.get_data(as_text=True)
        self.assertIn("se eliminó", pagina)
        self.assertEqual(self.cliente.get("/areas/lean-startup").status_code, 404)
        self.assertEqual(self.cliente.post("/areas/lean-startup/eliminar").status_code, 404)

    def test_subareas_desde_la_pantalla(self):
        self.cliente.post("/areas/nueva", data={"nombre": "Programación"})
        respuesta = self.cliente.post("/areas/programacion/subareas", data={"nombre": "CS50"})
        self.assertEqual(respuesta.status_code, 302)
        self.assertTrue(respuesta.headers["Location"].endswith("/areas/programacion-cs50"))

        # La lista principal muestra solo el padre, con su subárea contada
        principal = self.cliente.get("/areas").get_data(as_text=True)
        self.assertIn("1 subárea", principal)
        self.assertNotIn("/areas/programacion-cs50", principal)

        # Dentro del padre aparece la subárea; dentro de la subárea, el camino de vuelta
        self.assertIn("/areas/programacion-cs50", self.cliente.get("/areas/programacion").get_data(as_text=True))
        hija = self.cliente.get("/areas/programacion-cs50").get_data(as_text=True)
        self.assertIn('href="/areas/programacion"', hija)

        repetida = self.cliente.post("/areas/programacion/subareas", data={"nombre": "cs50"}).get_data(as_text=True)
        self.assertIn("Ya existe un área", repetida)

    def test_importar_subarea_y_eliminar_el_padre_pide_confirmacion_con_la_lista(self):
        bloque = dict(BLOQUE, area="Programación > CS50")
        self.cliente.post("/importar/confirmar", data={"texto": json.dumps(bloque, ensure_ascii=False)})

        confirmacion = self.cliente.get("/areas/programacion/eliminar").get_data(as_text=True)
        self.assertIn("1 subárea", confirmacion)
        self.assertIn("Programación &gt; CS50", confirmacion)

        pagina = self.cliente.post("/areas/programacion/eliminar", follow_redirects=True).get_data(as_text=True)
        self.assertIn("y sus 1 subárea", pagina)
        self.assertEqual(self.cliente.get("/areas/programacion-cs50").status_code, 404)

    def preparar_tema_y_destino(self):
        self.importar()  # área "Lean Startup", tema "MVP"
        self.cliente.post("/areas/nueva", data={"nombre": "Python"})
        return json.loads(Path(self.temporal.name, "areas", "lean-startup.json").read_text(encoding="utf-8"))["temas"][0]["id"]

    def test_mover_un_tema_desde_la_pantalla(self):
        id_tema = self.preparar_tema_y_destino()
        # La página del área ofrece el destino y el botón de eliminar
        pagina = self.cliente.get("/areas/lean-startup").get_data(as_text=True)
        self.assertIn('value="python"', pagina)
        self.assertIn(f"/areas/lean-startup/temas/{id_tema}/eliminar", pagina)

        respuesta = self.cliente.post(f"/areas/lean-startup/temas/{id_tema}/mover", data={"destino": "python"}, follow_redirects=True)
        texto = respuesta.get_data(as_text=True)
        self.assertIn("se movió a", texto)
        self.assertIn("MVP", self.cliente.get("/areas/python").get_data(as_text=True))
        self.assertNotIn("Producto mínimo viable", self.cliente.get("/areas/lean-startup").get_data(as_text=True))

    def test_mover_a_un_destino_invalido_muestra_error(self):
        id_tema = self.preparar_tema_y_destino()
        pagina = self.cliente.post(f"/areas/lean-startup/temas/{id_tema}/mover", data={"destino": "no-existe"}).get_data(as_text=True)
        self.assertIn("No encontré el área de destino", pagina)

    def test_eliminar_un_tema_pide_confirmacion_y_despues_elimina(self):
        id_tema = self.preparar_tema_y_destino()
        confirmacion = self.cliente.get(f"/areas/lean-startup/temas/{id_tema}/eliminar").get_data(as_text=True)
        self.assertIn("1 pregunta", confirmacion)
        self.assertIn("Producto mínimo viable", self.cliente.get("/areas/lean-startup").get_data(as_text=True))  # aún está

        pagina = self.cliente.post(f"/areas/lean-startup/temas/{id_tema}/eliminar", follow_redirects=True).get_data(as_text=True)
        self.assertIn("se eliminó", pagina)
        self.assertNotIn("Producto mínimo viable", pagina)
        self.assertEqual(self.cliente.get(f"/areas/lean-startup/temas/{id_tema}/eliminar").status_code, 404)

    def test_area_inexistente_da_404(self):
        self.assertEqual(self.cliente.get("/areas/no-existe").status_code, 404)
        self.assertEqual(self.cliente.get("/areas/..%2Fimportados").status_code, 404)

    def test_exportar_devuelve_un_zip(self):
        self.importar()
        respuesta = self.cliente.get("/exportar")
        self.assertEqual(respuesta.mimetype, "application/zip")
        self.assertTrue(respuesta.data.startswith(b"PK"))


if __name__ == "__main__":
    unittest.main()
