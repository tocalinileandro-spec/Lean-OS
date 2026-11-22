/**
 * IDs de la sección 4 de la visión y cuáles son exigibles en la fase actual.
 *
 * REGLA: la lista de exigibles solo se AMPLÍA al avanzar de fase. Nunca se
 * reduce ni se mueve un ID a "pendiente" para hacer pasar algo.
 */

export const TODOS_LOS_IDS = [
  "I1", "I2", "I3", "I4", "I5", "I6", "I7",
  "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9",
  "T1", "T2",
  "A1", "A2",
  "S1", "S2", "S3", "S4", "S5", "S6", "S7",
  "G1", "G2", "G3", "G4", "G5",
  "B1", "B2", "B3",
  "O1", "O2", "O3", "O4", "O5", "O6",
] as const;

export type IdPrueba = (typeof TODOS_LOS_IDS)[number];

/** Fase en la que pasa a ser exigible cada ID (plan de la sección 8). */
export const FASE_DE_CADA_ID: Record<IdPrueba, number> = {
  I1: 2, I2: 2, I3: 2, I4: 2, I5: 2, I6: 2, I7: 2,
  R1: 2, R2: 2, R3: 2, R4: 2, R5: 2, R6: 2, R7: 2, R8: 2, R9: 2,
  S1: 2,
  T1: 3, T2: 3, A1: 3, A2: 3,
  S2: 4, S3: 4, S4: 4, S5: 4, S6: 4, S7: 4,
  G1: 4, G2: 4, G3: 4, G4: 4, G5: 4, B3: 4,
  B1: 1,
  B2: 5,
  O1: 6, O2: 6, O3: 6, O4: 6, O5: 6, O6: 6,
};

/** IDs exigibles hoy. Se amplía por fase (fase 1: B1; fase 2 en curso: se suman I1-I7, R1-R9, S1; fase 5: B2). */
export const IDS_EXIGIBLES: readonly IdPrueba[] = ["B1", "I1", "I2", "I3", "I4", "I5", "I6", "I7", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "S1", "S3", "S4", "S5", "S6", "G4", "T1", "T2", "A1", "A2", "G1", "G2", "G3", "S2", "S7", "G5", "B3", "B2", "O1", "O2", "O3", "O4", "O5", "O6"];
