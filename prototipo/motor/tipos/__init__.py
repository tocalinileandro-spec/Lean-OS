"""Los tipos de bloque que se pueden importar.

PARA SUMAR UN TIPO NUEVO (por ejemplo "tareas"):
  1. Creá el archivo tipos/tareas.py copiando la estructura de aprendizaje.py
     (necesita: NOMBRE, validar, describir y guardar).
  2. Agregalo a la lista TIPOS de abajo (una línea, nada más).
Nada más del programa se toca: importar.py usa esta lista.
"""

from motor.tipos import aprendizaje

# La clave es el valor del campo "tipo" del bloque JSON.
TIPOS = {
    aprendizaje.NOMBRE: aprendizaje,
}
