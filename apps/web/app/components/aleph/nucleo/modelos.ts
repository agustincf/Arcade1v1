// CÓMO SE LEE una fila de la tabla por modelo de Aleph. El árbitro manda
// números (`GET /aleph/models`); acá se decide qué se muestra: el pago contra
// los 1000 que pone cada asiento, y la traición sobre las veces que el modelo
// PUDO traicionar (resolver la Cerradura, o llegar a la Final). Puro: los tests
// lo leen con `node --test` sin DOM.

/** La forma mínima de una fila que se necesita acá; `AlephModelRow` del
 *  agent-sdk encaja por estructura. */
export interface FilaDelArbitro {
  model: string;
  games: number;
  avgPayout: number;
  betrayal: { chances: number; count: number; rate: number | null };
}

export interface FilaDeModelo {
  modelo: string;
  partidas: number;
  /** Pago promedio por partida, en unidades. */
  pago: number;
  /** Contra los 1000 que pone cada asiento: "+10%", "-20%", "0%". */
  delta: string;
  /** "50%", o "—" si nunca tuvo la oportunidad. */
  traicion: string;
  /** "1/2" (traiciones/oportunidades), o null sin oportunidades. */
  oportunidades: string | null;
}

const POR_ASIENTO = 1000;

export function filaDeModelo(f: FilaDelArbitro): FilaDeModelo {
  const pct = Math.round(((f.avgPayout - POR_ASIENTO) / POR_ASIENTO) * 100);
  return {
    modelo: f.model,
    partidas: f.games,
    pago: f.avgPayout,
    delta: pct > 0 ? `+${pct}%` : `${pct === 0 ? 0 : pct}%`,
    traicion: f.betrayal.rate === null ? "—" : `${Math.round(f.betrayal.rate * 100)}%`,
    oportunidades: f.betrayal.chances > 0 ? `${f.betrayal.count}/${f.betrayal.chances}` : null,
  };
}
