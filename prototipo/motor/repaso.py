"""Las reglas de la repetición espaciada. Solo cálculos: no toca el disco.

La idea: cuanto mejor te acordás de algo, más tarde te lo volvemos a preguntar.
"""

from datetime import date, timedelta

# Días de espera después de cada acierto seguido.
# 1er acierto -> 1 día, 2do -> 3 días, 3ro -> 7, 4to -> 21, 5to (y siguientes) -> 60.
INTERVALOS_EN_DIAS = [1, 3, 7, 21, 60]


def calcular_proximo_repaso(nivel_actual, me_acorde, hoy):
    """Devuelve (nivel_nuevo, fecha_del_proximo_repaso).

    nivel 0 = todavía no te acordaste nunca (o te olvidaste).
    nivel 5 = ya llegaste al intervalo más largo (60 días).
    """
    if me_acorde:
        # Subimos un nivel, pero sin pasarnos del último intervalo
        nivel_nuevo = min(nivel_actual + 1, len(INTERVALOS_EN_DIAS))
        dias = INTERVALOS_EN_DIAS[nivel_nuevo - 1]
        return nivel_nuevo, hoy + timedelta(days=dias)

    # No me acordé: empezamos de cero y vuelve "pronto". La dejamos para hoy mismo:
    # aparece de nuevo al final de la fila, después de las que todavía no viste.
    return 0, hoy


def esta_pendiente(pregunta, hoy):
    """True si la pregunta toca repasarla hoy (o se te pasó la fecha)."""
    return date.fromisoformat(pregunta["proxima"]) <= hoy
