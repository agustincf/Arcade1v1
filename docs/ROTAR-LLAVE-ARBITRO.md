# Rotar la llave del árbitro

> Lo corre el dueño. Es el W8 de [MAINNET.md](MAINNET.md) (pre-auditoría F5 /
> RT3-04). Sirve igual en testnet y en mainnet.

El árbitro firma tres cosas con su llave: los **asientos** (autorizan a un
jugador a depositar), los **resultados** del 1v1 (le pagan al ganador) y las
**tablas de pago** de Aleph. Los dos contratos (`Escrow1v1` y `EscrowAleph`)
aceptan solo lo que firmó la dirección que tienen en `arbiter()`. Rotar la llave
es cambiar las dos puntas: la llave del servidor y el `arbiter()` de los
contratos.

## Qué hace solo el árbitro (desde W8)

- **Vuelve a firmar los resultados pendientes.** Antes de liquidar una partida
  decidida, mira si la firma es de su llave actual. Si no (se decidió antes de
  rotar), firma de nuevo el **mismo** ganador con el **mismo** plazo, la guarda
  y recién entonces la manda. En el log:
  `[settle] <id>: firmada con otra llave del árbitro; se vuelve a firmar`.
- **Vuelve a firmar las tablas de Aleph** pendientes de pago, por el mismo
  motivo.
- **Da asientos nuevos.** La web vuelve a preguntarle al árbitro justo antes de
  depositar (el que abre y el que se une) y deposita con el asiento recién
  firmado.
- **Cierra las mesas pagas mientras no coinciden** (W6): si la llave del
  servidor no es el `arbiter()` del contrato, no firma asientos y `/health` dice
  `"escrow":"blocked"`. La ladder gratis sigue andando.

Lo que **no** puede hacer: ninguna firma vieja vuelve a servir. Mientras las dos
puntas no coinciden, los pagos esperan (se reintentan con backoff, hasta 5
minutos entre intentos). Una firma de resultado vence a `playDeadline + 30 min`:
por eso los pasos 3 y 4 van **seguidos, en minutos**. Si una partida no llega,
se reembolsa (la plata no se pierde, pero el ganador no cobra el premio).

## Pasos

1. **Generá la llave nueva** fuera de este repo y de cualquier chat (en mainnet,
   en el KMS/HSM que se elija: C12 y O2 de [MAINNET.md](MAINNET.md)). Anotá su
   dirección. Tiene que ser una cuenta común, distinta de la Ledger, la Safe y
   la wallet de la comisión.
2. **Cargale ETH para el gas** a la dirección nueva (en la red que corresponda):
   el árbitro paga las liquidaciones y los reembolsos.
3. **Cambiá la llave en Render**: `ARBITER_PRIVATE_KEY` del servicio del
   árbitro, y guardá. Render redespliega solo. Cuando arranca, `/health` dice
   `"escrow":"blocked"`: es lo esperado (el contrato todavía tiene la vieja).
4. **Enseguida, desde la Safe** (el dueño de los contratos), llamá:
   - `Escrow1v1.setArbiter(<dirección nueva>)`
   - `EscrowAleph.setArbiter(<dirección nueva>)`
5. **Verificá** (en un minuto como mucho):

   ```bash
   curl -s https://arcade1v1.onrender.com/health
   ```

   Tiene que decir `"escrow":"ok"`. En los logs de Render, las partidas que
   estaban esperando su pago muestran el "se vuelve a firmar" y después el
   `liquidada por el árbitro`.

6. **Retirá la llave vieja**: pasá el ETH que le quede a otra cuenta y no la
   vuelvas a usar.

## Si la llave vieja se filtró

Invertí los pasos 3 y 4: **primero** `setArbiter` desde la Safe (desde ese
momento nada de lo que firme la llave robada sirve), **después** la llave nueva
en Render. Entre los dos, el árbitro viejo sigue corriendo pero ninguna firma
suya pasa: los pagos esperan y se reintentan solos cuando arranca el nuevo.

## Qué mirar si algo no cierra

- `/health` sigue en `"blocked"` después del paso 4: el motivo viene en el log
  del arranque (`escrow-check`). Lo más común: la llave de Render no es la de la
  dirección que pusiste en `setArbiter`, o la transacción de la Safe no se
  ejecutó.
- Una partida decidida no se paga: buscá su id en el log. Si dice `intento N
falló`, el árbitro sigue reintentando (¿tiene gas la dirección nueva?).
- Un jugador no puede depositar ("bad seat"): que recargue la partida y
  reintente; la web pide un asiento nuevo antes de depositar.
