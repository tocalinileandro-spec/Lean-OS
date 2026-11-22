/** El código recibe el reloj como dependencia para poder simular el tiempo en las pruebas. */
export interface Reloj {
  /** Instante actual. */
  ahora(): Date;
}

export class RelojReal implements Reloj {
  ahora(): Date {
    return new Date();
  }
}

/** Reloj controlado a mano, para pruebas. */
export class RelojSimulado implements Reloj {
  #ms: number;

  constructor(inicio: Date | string | number) {
    this.#ms = new Date(inicio).getTime();
  }

  ahora(): Date {
    return new Date(this.#ms);
  }

  fijar(instante: Date | string | number): void {
    this.#ms = new Date(instante).getTime();
  }

  avanzarMs(ms: number): void {
    this.#ms += ms;
  }

  avanzarMinutos(minutos: number): void {
    this.avanzarMs(minutos * 60_000);
  }

  avanzarDias(dias: number): void {
    this.avanzarMs(dias * 86_400_000);
  }
}
