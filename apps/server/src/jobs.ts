// LOS RELOJES DEL ÁRBITRO: el barrido de partidas, el runner de agentes, el
// ticker y la casa de Aleph, y el monitor de gas. Solo corren en la instancia
// dueña de la posta: index.ts los arranca DESPUÉS de cargar el estado, y la
// entrega de la posta los frena ANTES del guardado final, así la foto que carga
// la instancia nueva es la última (ver handover.ts).

export interface Job {
  name: string;
  start(): void;
  /** Frena el reloj y espera la vuelta que estaba en curso. */
  stop(): Promise<void>;
}

const jobs: Job[] = [];

export function registerJob(job: Job): void {
  jobs.push(job);
}

export function startJobs(): void {
  for (const j of jobs) j.start();
}

/** Frena todos. Si alguno tarda más que `capMs`, se sigue igual: lo que se
 *  publica on-chain ya se guarda antes (ver persistNow en aleph.ts). Devuelve
 *  los nombres de los que no terminaron a tiempo. */
export async function stopJobs(capMs: number): Promise<string[]> {
  const late: string[] = [];
  await Promise.all(
    jobs.map(async (j) => {
      let timer: NodeJS.Timeout | undefined;
      const capped = new Promise<false>((ok) => {
        timer = setTimeout(() => ok(false), capMs);
      });
      const done = j.stop().then(
        () => true as const,
        (e) => {
          console.error(`[relojes] ${j.name}:`, (e as Error).message);
          return true as const;
        },
      );
      const ok = await Promise.race([done, capped]);
      clearTimeout(timer);
      if (!ok) late.push(j.name);
    }),
  );
  return late;
}

/** Tests: vaciar el registro. */
export function resetJobsForTests(): void {
  jobs.length = 0;
}
