// Lo único que hace JavaScript en Lean OS: mostrar/ocultar partes de la pantalla de repaso.
// No guarda nada ni habla con el servidor; eso lo hacen los formularios.

const botonRespuesta = document.getElementById("boton-respuesta");
const zonaRespuesta = document.getElementById("zona-respuesta");
const indicacion = document.getElementById("indicacion");
const botonPista = document.getElementById("boton-pista");
const textoPista = document.getElementById("texto-pista");
const dialogo = document.getElementById("dialogo-resumen");

// "Ver respuesta": muestra la respuesta y los dos botones de "me acordé"
botonRespuesta.addEventListener("click", function () {
  zonaRespuesta.hidden = false;
  botonRespuesta.hidden = true;
  indicacion.hidden = true;
  // Llevamos el foco al botón principal para poder seguir con el teclado (Enter)
  document.getElementById("boton-si").focus();
});

// "Ver pista" (solo existe si la pregunta tiene pista)
if (botonPista) {
  botonPista.addEventListener("click", function () {
    textoPista.hidden = false;
    botonPista.hidden = true;
  });
}

// Resumen del tema en una ventanita
document.getElementById("boton-resumen").addEventListener("click", function () {
  dialogo.showModal();
});
document.getElementById("cerrar-resumen").addEventListener("click", function () {
  dialogo.close();
});
// Tocar fuera de la ventanita también la cierra
dialogo.addEventListener("click", function (evento) {
  if (evento.target === dialogo) {
    dialogo.close();
  }
});
