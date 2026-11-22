/** Decide la carpeta de datos de la app de Windows (función pura, sin Electron ni disco). */
export function resolverCarpetaDatos(env: Record<string, string | undefined>, carpetaNormal: () => string): string {
  const datos = env["LEAN_OS_DATOS"];
  const prueba = env["LEAN_OS_PRUEBA"];
  if (prueba !== undefined && prueba !== "" && (datos === undefined || datos === "")) {
    throw new Error("LEAN_OS_PRUEBA está definida pero falta LEAN_OS_DATOS. Los modos de prueba necesitan una carpeta de datos temporal para no tocar tus datos reales. No se hizo nada.");
  }
  return datos !== undefined && datos !== "" ? datos : carpetaNormal();
}
