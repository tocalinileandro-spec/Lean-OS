"""Errores propios del motor.

Los usamos para devolver mensajes claros en español en vez de dejar
que el programa se rompa con un error técnico.
"""


class ErrorDeImportacion(Exception):
    """El bloque pegado tiene algún problema. Guarda una lista de mensajes."""

    def __init__(self, mensajes):
        # Aceptamos un mensaje suelto o una lista; siempre guardamos una lista
        if isinstance(mensajes, str):
            mensajes = [mensajes]
        self.mensajes = mensajes
        super().__init__(" | ".join(mensajes))
