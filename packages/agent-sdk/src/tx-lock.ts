// UN CANDADO POR WALLET para mandar transacciones. Dos envíos de la misma
// wallet a la vez (un depósito 1v1 y uno de Aleph, o un approve y un open de dos
// llamadas distintas) chocarían en el nonce, y uno de los dos quedaría
// revertido o colgado. El candado cubre solo el envío, el recibo y el sellado de
// cada transacción, nunca una partida entera: así un depósito de Aleph no espera
// a que termine de jugarse una partida 1v1.

export type TxLock = <T>(fn: () => Promise<T>) => Promise<T>;

// Uno por dirección en todo el proceso: dos `createAgent` con la MISMA clave
// comparten candado (si no, cada uno tendría el suyo y chocarían en el nonce).
const byWallet = new Map<string, TxLock>();

/** El candado de esta wallet, compartido por todos los agentes del proceso. */
export function txLockFor(address: string): TxLock {
  const key = address.toLowerCase();
  let lock = byWallet.get(key);
  if (!lock) {
    lock = createTxLock();
    byWallet.set(key, lock);
  }
  return lock;
}

export function createTxLock(): TxLock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    // El que sigue espera a este, salga bien o mal.
    tail = run.catch(() => {});
    return run;
  };
}
