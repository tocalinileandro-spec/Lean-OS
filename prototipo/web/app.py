"""Las páginas de Lean OS.

Regla de este archivo: no calcula ni guarda nada por su cuenta.
Cada página le pide el trabajo al motor y muestra el resultado.
"""

import io
from datetime import date

from flask import Flask, abort, redirect, render_template, request, send_file, url_for

from motor import areas, estudio, importar, respaldo, temas
from motor.almacen import Almacen
from motor.errores import ErrorDeImportacion

MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def crear_aplicacion(configuracion):
    """Arma la aplicación web. Recibe la configuración ya leída (ver motor/configuracion.py)."""
    app = Flask(__name__)
    almacen = Almacen(configuracion["carpeta_datos"])
    respaldos_a_conservar = configuracion["respaldos_a_conservar"]

    # ---------- Cosas que corren en todas las páginas ----------

    @app.before_request
    def respaldo_diario():
        """Antes de cada visita, deja el respaldo de hoy al día con tus datos."""
        if request.endpoint == "static":
            return
        try:
            respaldo.actualizar_respaldo_de_hoy(almacen, date.today(), respaldos_a_conservar)
        except OSError as error:
            # Un respaldo fallido no debe impedir usar la app; solo avisamos en la consola
            print(f"Aviso: no se pudo hacer el respaldo de hoy: {error}")

    @app.context_processor
    def datos_para_todas_las_paginas():
        """Variables disponibles en todas las plantillas (el contador de la barra)."""
        tarjetas = estudio.tarjetas_de_areas(almacen, date.today())
        return {
            # Sumamos solo las áreas principales: sus números ya incluyen a las subáreas
            "pendientes_total": sum(t["cantidad_pendientes"] for t in tarjetas if t["es_raiz"]),
            # Los nombres de las áreas existentes, para recordártelos al importar
            "nombres_areas": [t["nombre"] for t in tarjetas],
        }

    @app.template_filter("fecha_corta")
    def fecha_corta(texto_iso):
        """"2026-11-15" -> "15 nov 2026" """
        fecha = date.fromisoformat(str(texto_iso))
        return f"{fecha.day} {MESES[fecha.month - 1]} {fecha.year}"

    @app.errorhandler(404)
    def no_encontrado(_error):
        return render_template("no_encontrado.html", seccion=""), 404

    # ---------- Áreas ----------

    def _areas_principales():
        """Las tarjetas de la lista principal (las subáreas se ven dentro de su padre)."""
        tarjetas = estudio.tarjetas_de_areas(almacen, date.today())
        return [t for t in tarjetas if t["es_raiz"]]

    @app.route("/")
    @app.route("/areas")
    def ver_areas():
        return render_template(
            "areas.html",
            tarjetas=_areas_principales(),
            eliminada=request.args.get("eliminada", ""),  # nombre del área recién eliminada
            subareas_eliminadas=request.args.get("subareas", type=int, default=0),
            seccion="areas",
        )

    @app.route("/areas/nueva", methods=["POST"])
    def crear_area():
        nombre = request.form.get("nombre", "")
        try:
            area = areas.crear_area_vacia(almacen, nombre, date.today())
        except ValueError as error:
            # Mostramos la lista de áreas de nuevo, con el mensaje y lo que escribiste
            return render_template(
                "areas.html", tarjetas=_areas_principales(), error=str(error), nombre_nuevo=nombre, seccion="areas"
            )
        return redirect(url_for("ver_area", slug=area["slug"]))

    def _pagina_de_area(slug, error="", nombre_nuevo=""):
        """Arma la página de un área: sus subáreas, sus temas y el camino hasta ella."""
        area = areas.cargar_area(almacen, slug)
        if area is None:
            abort(404)

        tarjetas = estudio.tarjetas_de_areas(almacen, date.today())
        # Los números de la tarjeta de esta área incluyen a sus subáreas
        mi_tarjeta = next(t for t in tarjetas if t["slug"] == slug)
        subareas = [t for t in tarjetas if t["padre_nombre"].casefold() == area["nombre"].casefold()]

        return render_template(
            "area.html",
            area=area,
            titulo=mi_tarjeta["titulo"],
            ancestros=areas.ancestros_de(almacen, area),
            subareas=subareas,
            temas=areas.temas_ordenados(area),
            pendientes=mi_tarjeta["cantidad_pendientes"],
            # A dónde se puede mover un tema: cualquier otra área o subárea
            destinos=[t for t in tarjetas if t["slug"] != slug],
            # Avisos que llegan en la dirección después de mover o eliminar un tema
            tema_movido=request.args.get("movido", ""),
            area_de_destino=areas.cargar_area(almacen, request.args.get("destino", "")),
            tema_eliminado=request.args.get("tema_eliminado", ""),
            error=error,
            nombre_nuevo=nombre_nuevo,
            seccion="areas",
        )

    @app.route("/areas/<slug>")
    def ver_area(slug):
        return _pagina_de_area(slug)

    @app.route("/areas/<slug>/subareas", methods=["POST"])
    def crear_subarea(slug):
        area = areas.cargar_area(almacen, slug)
        if area is None:
            abort(404)
        nombre = request.form.get("nombre", "")
        try:
            # La subárea se llama "<este área> > <lo que escribiste>"
            nueva = areas.crear_area_vacia(almacen, area["nombre"] + areas.SEPARADOR + nombre, date.today())
        except ValueError as error:
            return _pagina_de_area(slug, error=str(error), nombre_nuevo=nombre)
        return redirect(url_for("ver_area", slug=nueva["slug"]))

    # ---------- Temas: mover y eliminar ----------

    @app.route("/areas/<slug>/temas/<id_tema>/mover", methods=["POST"])
    def mover_tema(slug, id_tema):
        try:
            _, tema = temas.buscar_tema(almacen, slug, id_tema)
            destino = temas.mover_tema(almacen, slug, id_tema, request.form.get("destino", ""))
        except ValueError as error:
            return _pagina_de_area(slug, error=str(error))
        return redirect(url_for("ver_area", slug=slug, movido=tema["tema"], destino=destino["slug"]))

    @app.route("/areas/<slug>/temas/<id_tema>/eliminar")
    def confirmar_eliminar_tema(slug, id_tema):
        """Pregunta antes de eliminar un tema."""
        try:
            area, tema = temas.buscar_tema(almacen, slug, id_tema)
        except ValueError:
            abort(404)
        return render_template("tema_eliminar.html", area=area, tema=tema, seccion="areas")

    @app.route("/areas/<slug>/temas/<id_tema>/eliminar", methods=["POST"])
    def eliminar_tema(slug, id_tema):
        try:
            tema = temas.eliminar_tema(almacen, slug, id_tema)
        except ValueError:
            abort(404)
        return redirect(url_for("ver_area", slug=slug, tema_eliminado=tema["tema"]))

    @app.route("/areas/<slug>/eliminar")
    def confirmar_eliminar_area(slug):
        """Pregunta antes de eliminar: muestra qué se va a perder (incluidas las subáreas)."""
        area = areas.cargar_area(almacen, slug)
        if area is None:
            abort(404)
        rama = areas.rama_de(almacen, area)  # el área y todas sus subáreas
        return render_template(
            "area_eliminar.html",
            area=area,
            subareas=[otra for otra in rama if otra["slug"] != slug],
            cantidad_temas=sum(len(otra["temas"]) for otra in rama),
            cantidad_preguntas=sum(len(tema["preguntas"]) for otra in rama for tema in otra["temas"]),
            seccion="areas",
        )

    @app.route("/areas/<slug>/eliminar", methods=["POST"])
    def eliminar_area(slug):
        try:
            eliminadas = areas.eliminar_area(almacen, slug)
        except ValueError:
            abort(404)
        # La primera de la lista es la que pediste eliminar; el resto son sus subáreas
        return redirect(url_for("ver_areas", eliminada=eliminadas[0]["nombre"], subareas=len(eliminadas) - 1))

    # ---------- Importar ----------

    @app.route("/importar")
    def pagina_importar():
        return render_template("importar.html", texto="", errores=[], seccion="importar")

    @app.route("/importar/revisar", methods=["POST"])
    def revisar_importacion():
        texto = request.form.get("texto", "")
        try:
            revision = importar.revisar(almacen, texto)
        except ErrorDeImportacion as error:
            # Volvemos al cuadro con el texto intacto para que lo puedas corregir
            return render_template("importar.html", texto=texto, errores=error.mensajes, seccion="importar")
        return render_template("importar_revision.html", texto=texto, revision=revision, seccion="importar")

    @app.route("/importar/confirmar", methods=["POST"])
    def confirmar_importacion():
        texto = request.form.get("texto", "")
        try:
            resultado = importar.guardar(almacen, texto)
        except ErrorDeImportacion as error:
            return render_template("importar.html", texto=texto, errores=error.mensajes, seccion="importar")
        return render_template("importar_resultado.html", resultado=resultado, seccion="importar")

    # ---------- Repaso ----------

    @app.route("/repaso")
    def ver_repaso():
        hoy = date.today()
        filtro = request.args.get("area", "")
        area_elegida = areas.cargar_area(almacen, filtro)
        if area_elegida is None:
            filtro = ""  # un área que no existe se ignora: se muestra todo lo de hoy

        item, quedan = estudio.siguiente_pregunta(almacen, hoy, filtro or None)
        return render_template(
            "repaso.html",
            item=item,
            quedan=quedan,
            filtro=filtro,
            tarjetas=estudio.tarjetas_de_areas(almacen, hoy),
            proxima_fecha=None if item else estudio.proxima_fecha_futura(almacen, hoy, filtro or None),
            seccion="repaso",
        )

    @app.route("/repaso/responder", methods=["POST"])
    def responder_repaso():
        try:
            estudio.responder(
                almacen,
                request.form.get("area_slug", ""),
                request.form.get("id_pregunta", ""),
                request.form.get("me_acorde") == "si",
            )
        except ValueError as error:
            print(f"Aviso: {error}")  # no se pudo guardar; igual seguimos con la próxima
        return redirect(url_for("ver_repaso", area=request.form.get("filtro", "") or None))

    # ---------- Exportar ----------

    @app.route("/exportar")
    def exportar_todo():
        contenido = respaldo.exportar_todo(almacen)
        return send_file(
            io.BytesIO(contenido),
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"lean-os-{date.today().isoformat()}.zip",
        )

    return app
