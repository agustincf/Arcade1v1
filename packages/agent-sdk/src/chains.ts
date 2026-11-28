// Las redes que conoce el SDK. La usan los depósitos de Aleph (con la red que
// nombra el árbitro) y los del 1v1 (con la que fijó el operador en `paid1v1`).
import type { Chain } from "viem";
import { foundry, base, baseSepolia } from "viem/chains";

/** Red según su `chainId`. Un id desconocido NO cae a una red por defecto: caer
 *  a baseSepolia hacía que la wallet siguiera hasta el primer write con una red
 *  que nadie eligió, y el error que viem tira ahí nombra la red equivocada. Un
 *  valor que no entendemos se rechaza acá, antes de leer ni gastar nada. */
export function chainFor(id: number): Chain {
  if (id === 31337) return foundry;
  if (id === 8453) return base;
  if (id === 84532) return baseSepolia;
  throw new Error(
    `unknown chainId ${id} from the arbiter: this SDK knows 8453 (base), 84532 (base sepolia) and 31337 (anvil)`,
  );
}
