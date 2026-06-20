# contracts — Contrato de escrow (Solidity, para Base)

El contrato inteligente que custodia el pozo y paga solo cuando corresponde:

- Recibe los **depositos** de los dos jugadores (en USDC).
- **Retiene el pozo** durante la partida.
- **Verifica la firma del arbitro** para conocer el resultado.
- Paga **premio al ganador** y envia la **comision (10%)** a la wallet de la
  plataforma.
- **Reembolsa** si la partida se cancela o falta un jugador.

> Vacio por ahora. Se construye en la **Fase 4** (en Base Sepolia / testnet).
> Tecnologia prevista: Solidity + Foundry.
