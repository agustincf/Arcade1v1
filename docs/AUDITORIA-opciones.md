# Auditoría externa de `Escrow1v1`: opciones, precios y el mail para pedir cotización

> Punto **L2** de [`docs/MAINNET.md`](MAINNET.md): sin ella, el script de deploy
> a Base mainnet no despliega. Investigado el **2026-11-18**. Los
> precios con fuente están citados abajo; los que dicen **"≈ (estimación)"**
> son cuentas propias sobre esas fuentes, porque casi nadie publica una tarifa
> fija. El paquete para el auditor ya está listo:
> [`packages/contracts/AUDIT.md`](../packages/contracts/AUDIT.md).

## En corto

- **Qué se audita:** un solo contrato, `Escrow1v1.sol`, de **317 líneas de
  código** (sin comentarios ni líneas en blanco), en la versión etiquetada
  `escrow1v1-audit` (commit `b054e80`, la misma que corre en testnet). Es
  chico: el precio de una auditoría depende del tamaño y de la complejidad, así
  que este contrato cae en la franja baja del mercado.
- **Recomendación: una revisión individual ("solo review") hecha por un
  auditor reconocido.** Costo **≈ USD 5.000–12.000 (estimación)**, 3 a 7 días
  hábiles de trabajo y arranque en 1 a 6 semanas. Pedí precio a dos lugares a la
  vez, con el mismo mail: **Cantina** (con el 10 % de descuento para proyectos
  de Base) y **Pashov Audit Group**. Quedate con la más barata que cumpla las
  cuatro condiciones de [la sección de abajo](#cómo-elegir-las-4-condiciones).
- **Gratis, en paralelo:** pedir la revisión gratuita que da Coinbase a
  proyectos de Base (no reemplaza la auditoría) y fijarse si se abrió una nueva
  temporada de los subsidios de auditoría de Optimism.
- **Lo que no conviene ahora:** las firmas grandes (más de USD 25.000 y 2 a 3
  meses de espera) y los concursos (≈ USD 20.000–30.000 en total). Tienen
  sentido para contratos más grandes, o más adelante como segunda capa.
- **Ojo:** Code4rena, la plataforma de concursos más conocida, anunció su
  cierre en mayo de 2026. Ya no es una opción.

## Por qué alcanza con una revisión individual

- **El contrato es chico y llega muy trabajado.** La pre-auditoría
  ([informe](auditorias/2026-10-02-preauditoria-escrow1v1.md)) dejó cobertura
  del 100 %, pruebas que juegan cientos de miles de operaciones al azar, 30 de
  30 bugs plantados detectados, dos analizadores automáticos y pruebas contra el
  USDC real. Un auditor con experiencia arranca de ahí, no de cero, y eso baja
  las horas que cobra.
- **Lo que está en juego en cada partida es poco:** mesas de 1 a 10 USDC por
  jugador. Pagar 2 a 4 veces más por tener muchos ojos (un concurso) no es
  proporcional para el lanzamiento.
- **Lo que sí hace falta del informe:** que sea publicable, que diga qué commit
  revisó y quién lo firma. Ese informe es el que se cita en
  `packages/contracts/build-aprobada.json` como la aprobación de la build; sin
  él no hay deploy a mainnet.
- **La segunda capa, cuando haya volumen:** un programa de recompensas por
  bugs ("bug bounty"). Para proyectos de Base, Cantina descuenta el 50 % del
  alojamiento del primer año e Immunefi un 15 % o más ([Base Services
  Hub][base-hub]).

## Las opciones, de menor a mayor costo

| #   | Opción                                                                    | Precio para este contrato                                                                                       | Arranca en                                            | Dura                                                                   | Qué entrega                                                                   | Qué tan reconocida                                                                    |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 0a  | **Revisión gratuita de Coinbase** (su equipo de seguridad, en beta)       | **USD 0**                                                                                                       | si te eligen (cupo limitado)                          | no publicado                                                           | revisión acotada con herramientas automáticas e IA; **no es una auditoría**   | Coinbase es quien opera Base, pero ellos mismos dicen que complementa a una auditoría |
| 0b  | **Subsidios de auditoría** (Optimism; Ethereum Foundation)                | Optimism: hasta el **100 %**; Ethereum Foundation: hasta el **30 %**                                            | Optimism: temporada 9 cerrada; la siguiente sin fecha | lo que dure la auditoría subsidiada                                    | la auditoría de la firma que la hace                                          | la de la firma; son competitivos (en un ciclo de Optimism, 2 de 12 aprobados)         |
| 1   | **Revisión individual** de un auditor reconocido (Cantina, Pashov)        | **≈ USD 5.000–12.000 (estimación)**                                                                             | ≈ 1–6 semanas (estimación)                            | **3–5 días** para un solo contrato (Pashov)                            | informe con hallazgos por gravedad; preguntar si incluye revisar los arreglos | alta si la persona tiene informes públicos                                            |
| 2   | **Firma chica o mediana** (Hexens, Paladin, Adevar, Guardian y similares) | **≈ USD 8.000–20.000 (estimación)**; contrato simple: "menos de USD 20.000" y una semana (Sherlock)             | 2–8 semanas (las más pedidas: 6–8, Sherlock)          | 1–2 semanas                                                            | informe con la marca de la firma                                              | media a alta, según la firma                                                          |
| 3   | **Concurso** (Immunefi, Cantina, Sherlock)                                | **≈ USD 20.000–30.000 (estimación)**: el caso más parecido tuvo un pozo de USD 25.000, más la comisión          | ≈ 2–6 semanas (estimación)                            | 1 semana de concurso + el juicio de los hallazgos                      | informe público con todo lo encontrado por muchos investigadores              | alta: muchos ojos a la vez                                                            |
| 4   | **Firma de primera línea** (Trail of Bits, OpenZeppelin, Spearbit)        | **≈ USD 25.000–50.000 o más (estimación)**: ~USD 25.000 por ingeniero por semana; Spearbit 32.500–48.000/semana | **2–3 meses** de lista de espera                      | ≈ 1–2 semanas para este tamaño (estimación); sus trabajos típicos, 4–8 | el informe de mayor reputación del mercado                                    | máxima                                                                                |

Para Base hay descuentos publicados por la propia Base en su [Base Services
Hub][base-hub]: **Cantina 10 %**, **Immunefi 15 % o más**, **Hexens 15 %** en
auditorías, **Paladin 10 %**, **Adevar Labs 30 %**, **Octane 15 %** y
**FailSafe USD 3.000** menos en la primera auditoría. Conviene mencionarlo
siempre al pedir precio.

### El detalle de cada una

**0a. Revisión gratuita de Coinbase.** El equipo de seguridad de Coinbase
(ProtoSec) revisa gratis los contratos de una tanda limitada de proyectos de
Base, con análisis automático e IA. Se pide con un formulario. Lo anunciaron en
julio de 2025 como beta y no publicaron fecha de cierre, así que puede que ya no
tome pedidos. Ellos mismos aclaran que **no reemplaza** una auditoría de un
tercero ([anuncio][base-free]). Vale la pena pedirla porque no cuesta nada.

**0b. Subsidios.**

- **Optimism (Superchain Audit Grants).** Pagan auditorías de proyectos en
  las redes de la Superchain, y Base es una de ellas. Puede cubrir hasta el
  100 % ([Hacken][hacken-grants]). No lo pide el proyecto: lo pide una firma
  habilitada en su nombre, y el código tiene que ser abierto y estar desplegado
  en una red elegible. La temporada 9 cerró las solicitudes el 20 de mayo de
  2026 ([informe final][op-s9]) y no encontramos fecha para la siguiente. Es
  competitivo: en un ciclo de 2025 se aprobaron 2 de 12 ([Nethermind][nm-s8]).
  **Qué hacer:** preguntarle a la firma que elijas si está habilitada y si hay
  una temporada abierta.
- **Ethereum Foundation (Ethereum Security Subsidy Program, abril de 2026).**
  Hasta el 30 % de la auditoría, con un fondo de USD 1 millón, repartido por
  orden de llegada a través de Areta ([The Block][ef-subsidy]; [cómo
  aplicar][nm-subsidies]). Está pensado para proyectos en **Ethereum
  mainnet**: no está claro que acepte uno en Base. Preguntar no cuesta nada,
  pero no contaría con él.

**1. Revisión individual de un auditor reconocido.** Una sola persona con
experiencia revisa el contrato entero y entrega un informe. Para 317 líneas
es el formato natural.

- **Cantina** es el mercado de auditores de Spearbit, uno de los grupos más
  respetados. Ofrece revisiones individuales con un especialista elegido según
  el lenguaje del proyecto; el precio es a pedido y depende del tamaño y del
  plazo ([Cantina][cantina-reviews]). Para proyectos de Base: 10 % menos.
- **Pashov Audit Group** es un grupo muy conocido por auditar contratos chicos
  y medianos, con informes públicos. Según un directorio, una revisión enfocada
  de un solo contrato le lleva **3 a 5 días**, y arrancan rápido
  ([Web3Connect][pashov-dir]). Su pedido de auditoría está en
  [pashov.com][pashov]. No publica precios.
- **De dónde sale el precio estimado:** contratos simples de USD 5.000 a 15.000
  en 2 a 5 días, y USD 20.000 para 500 a 1.000 líneas en 1 a 2 semanas
  ([Zealynx][zealynx]); un contrato simple con buena documentación, por debajo
  de USD 20.000 y alrededor de una semana ([Sherlock][sherlock-cost]). Este
  tiene 317 líneas, pero maneja plata y tiene detalles finos (el presupuesto de
  gas de cada pago, los plazos y las firmas): por eso la franja es USD
  5.000–12.000 y no menos.

**2. Firma chica o mediana.** Lo mismo pero con un equipo de 2 o más personas y
la marca de la firma en el informe. Cuesta más, aunque el contrato no lo
necesita para el tamaño que tiene. Es la alternativa si las dos cotizaciones de
la opción 1 salen caras o tardan mucho: con el descuento de Base, Hexens
(15 %) o Paladin (10 %) son las primeras a las que pedir.

**3. Concurso ("competitive audit").** Se pone un pozo de premios y muchos
investigadores compiten por encontrar fallas durante una semana.

- **El caso más parecido:** el concurso de Folks Finance en Immunefi (marzo de
  2026): **365 líneas, 6 días, pozo de USD 25.000**. Si no aparecía ningún bug
  se pagaba un piso de USD 3.750, pero un solo hallazgo, aunque sea menor,
  liberaba el pozo entero ([Immunefi][immunefi-folks]). A eso se suma la
  comisión de la plataforma, que no está publicada.
- **Sherlock** cambió en agosto de 2026 a su "Audit Engine", que mezcla IA y
  revisión humana y cobra en créditos; no publica cuánto vale cada crédito
  ([Sherlock][sherlock-engine]; [novedades de octubre][sherlock-oct]).
- **Code4rena** anunció su cierre el 13 de mayo de 2026; Immunefi se quedó con
  sus programas de recompensas ([Immunefi][c4-immunefi];
  [FinanceFeeds][c4-news]).
- **CodeHawks** (Cyfrin) casi no tiene actividad: el último concurso público
  que encontramos es de julio de 2026 ([CodeHawks][codehawks]).

**4. Firma de primera línea.** Trail of Bits cobra unos USD 25.000 por
ingeniero por semana y sus trabajos duran 4 a 8 semanas; Spearbit, USD 32.500 a
48.000 por semana por equipo ([Spark][spark]). Las firmas top tienen listas de
espera de 2 a 3 meses ([Zealynx][zealynx-2026]). Para 317 líneas es pagar la
marca, no el trabajo.

**Lo que no sirve como auditoría:** los escáneres con IA, aunque haya varios
gratis o con descuento para Base (Almanax, Firepan), y las "auditorías" de unos
cientos de dólares en sitios de trabajos freelance. Sirven como chequeo extra,
pero no se pueden citar como la aprobación del contrato y no le dan confianza a
nadie.

## Cómo elegir (las 4 condiciones)

Entre las cotizaciones que cumplan **las cuatro**, la más barata:

1. **Precio cerrado** (no por hora) que **incluya revisar los arreglos**, al
   menos una vez. Si el auditor encuentra algo que cambie el contrato, hay que
   arreglarlo y volver a revisarlo; cobrado aparte, una segunda pasada puede
   costar USD 5.000 a 20.000 ([Sherlock][sherlock-2026]).
2. **Nombre de quien revisa** y links a sus informes públicos anteriores.
3. **Informe publicable**, que diga el commit revisado (`b054e80`, etiqueta
   `escrow1v1-audit`).
4. **Fecha de arranque concreta**, idealmente dentro de las próximas 4 a 6
   semanas.

## Pasos

1. **Mandá el mail de abajo** a Cantina y a Pashov Audit Group (dónde, en la
   [sección de contactos](#dónde-mandarlo)). Si querés una tercera cotización,
   sumá a Immunefi o a Hexens, por el descuento de Base.
2. **El mismo día, gratis:** el formulario de la revisión de Coinbase y la
   pregunta por los subsidios de Optimism (va dentro del mail).
3. **Cuando lleguen las respuestas,** pasámelas y las comparo con las 4
   condiciones.
4. **Después de la auditoría:** si hubo cambios en el contrato, se arreglan, se
   mueve la etiqueta y el auditor revisa los arreglos. Con el informe final, se
   completa `packages/contracts/build-aprobada.json`
   (`npx tsx packages/contracts/deploy-mainnet.ts hash` en el commit auditado)
   y queda habilitado el deploy a mainnet.

**Ojo con el contrato mientras tanto:** no hay que tocar
`packages/contracts/src/Escrow1v1.sol`. Si cambia, hay que mover la etiqueta y
avisarle al auditor (y puede subir el precio).

## El mail para pedir cotización

En inglés, listo para copiar. Lo que va entre corchetes lo completás vos. No
lleva ningún dato personal: firmalo como quieras que te conozcan.

**Asunto:** `Audit quote request: Escrow1v1 (single Solidity contract, ~320 nSLOC, Base mainnet)`

```text
Hi [Cantina team / Pashov Audit Group team],

I'd like a quote for a security review of a single Solidity contract before
we deploy it to Base mainnet.

Project: Arcade1v1, a 1v1 skill arena. Two players (humans or AI agents) stake
the same amount of USDC, an off-chain arbiter verifies both runs by replay and
signs the winner, and the escrow pays the pot minus a 15% fee. Tables are
1, 2, 5 and 10 USDC per player.

Scope
- One contract: packages/contracts/src/Escrow1v1.sol, ~320 nSLOC.
- Version: tag escrow1v1-audit (commit b054e80) in a public repo:
  https://github.com/agustincf/Arcade1v1/tree/escrow1v1-audit
- Contract:
  https://github.com/agustincf/Arcade1v1/blob/escrow1v1-audit/packages/contracts/src/Escrow1v1.sol
- Audit brief (scope, trust model, invariants, accepted risks, questions for
  the auditor):
  https://github.com/agustincf/Arcade1v1/blob/main/packages/contracts/AUDIT.md
- Stack: solc 0.8.24, OpenZeppelin 5.6.1 (Ownable2Step, ReentrancyGuard,
  EIP712, ECDSA, SafeERC20), Foundry. Target: Base mainnet, Circle USDC.
- Out of scope: the off-chain arbiter (described as a trust assumption),
  deploy scripts, and a second escrow contract that stays on testnet.

What's already done: an internal pre-audit (report linked from the brief),
100% line/branch coverage, stateful invariant fuzzing, mutation testing
(30/30 mutants caught), fork tests against real USDC on Base, and Slither and
Aderyn on the final source. The same version runs on Base Sepolia.

What we need
- A written report we can publish, stating the reviewed commit and severity
  per finding.
- A review of our fixes (at least one round) included in the price.
- Ideally starting within the next 4-6 weeks; we are flexible on dates.

Questions
1. Fixed price for this scope, and what it includes.
2. Who would do the review, and links to their previous public reports.
3. Earliest start date and expected duration.
4. Is the fix review included? How many rounds?
5. Payment terms and accepted currencies (fiat or USDC).
6. We build on Base: does the Base Builder discount listed in the Base
   Services Hub apply?
7. Are you a whitelisted provider for the Optimism Superchain audit grants,
   and is a season open now?

Thanks,
[Name]
[Contact]
```

**Versión corta** (para un formulario web o un mensaje de Telegram):

```text
Quote request: security review of one Solidity contract (~320 nSLOC) before
Base mainnet. Escrow for 1v1 USDC matches (1-10 USDC per player, arbiter-signed
results). Public repo, tag escrow1v1-audit (commit b054e80):
https://github.com/agustincf/Arcade1v1/tree/escrow1v1-audit
Audit brief: https://github.com/agustincf/Arcade1v1/blob/main/packages/contracts/AUDIT.md
Internal pre-audit done (100% coverage, invariants, mutation, Slither/Aderyn).
Looking for: fixed price incl. one fix-review round, publishable report, start
in 4-6 weeks. We build on Base (Base Builder discount?).
```

## Dónde mandarlo

| A quién                     | Cómo                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cantina**                 | Desde el [Base Services Hub][base-hub], en la fila de Cantina (el link del descuento). Si ese link no anda, el pedido de cotización de [cantina.xyz][cantina-reviews] mencionando "Base Builder Stack discount". |
| **Pashov Audit Group**      | El pedido de auditoría de [pashov.com][pashov] (o su Telegram, `@pashovkrum`, según su web).                                                                                                                     |
| Immunefi (opcional)         | Desde el [Base Services Hub][base-hub], en la fila de Immunefi (formulario de ventas, 15 % o más).                                                                                                               |
| Hexens (opcional)           | Desde el [Base Services Hub][base-hub], en la fila de Hexens (15 % en auditorías).                                                                                                                               |
| Coinbase (gratis)           | El formulario del [anuncio de la revisión gratuita][base-free].                                                                                                                                                  |
| Ethereum Foundation (si va) | El formulario de Areta, enlazado desde [Nethermind][nm-subsidies].                                                                                                                                               |

## Fuentes

Consultadas el 2026-11-18. Las que dicen "terceros" son de directorios o blogs
de otras firmas, no de la empresa nombrada.

- [Sherlock: precios de auditoría, referencia de mercado 2026][sherlock-2026]
  (2026-02-18, actualizada 2026-11-13): un ERC-20 simple, USD 5.000–20.000;
  cada pasada de re-auditoría, USD 5.000–20.000; urgencia, +20–40 %.
- [Sherlock: cuánto cuesta una auditoría][sherlock-cost] (actualizada
  2026-11-13): un contrato simple con buena documentación, menos de USD 20.000;
  contratos básicos, alrededor de una semana; las firmas más pedidas, 6–8
  semanas de espera.
- [Zealynx: qué cuestan las auditorías][zealynx] (2026-01-06, actualizada
  2026-05-16) y [precios 2026][zealynx-2026] (terceros, estimaciones del
  autor): contratos simples USD 5.000–15.000 en 2–5 días; USD 20.000 para
  500–1.000 líneas en 1–2 semanas; las firmas top, 2–3 meses de espera.
- [Spark: comparación de firmas][spark] (terceros, "a mediados de 2026"):
  Trail of Bits ~USD 25.000 por ingeniero por semana, 4–8 semanas; Spearbit USD
  32.500–48.000 por semana.
- [Web3Connect: Pashov Audit Group][pashov-dir] (terceros): 3–5 días para un
  solo contrato.
- [Cantina: revisiones de seguridad][cantina-reviews]: revisión individual,
  equipos o concurso; precio a pedido.
- [Base Services Hub][base-hub]: los descuentos para proyectos de Base.
- [Base: revisión de seguridad gratuita][base-free] (2025-07-29).
- [Immunefi: concurso de Folks Finance][immunefi-folks] (marzo de 2026).
- [Sherlock Audit Engine][sherlock-engine] y [novedades de octubre de
  2026][sherlock-oct].
- Cierre de Code4rena: [anuncio de Immunefi][c4-immunefi] y
  [FinanceFeeds][c4-news] (mayo de 2026).
- [CodeHawks: concurso de julio de 2026][codehawks].
- Subsidios: [Hacken (Superchain)][hacken-grants], [Optimism: informe final de
  la temporada 9][op-s9], [Nethermind: temporada 8][nm-s8], [The Block:
  subsidio de la Ethereum Foundation][ef-subsidy] (2026-04-14) y [Nethermind:
  programas de subsidio][nm-subsidies].

[sherlock-2026]: https://sherlock.xyz/post/smart-contract-audit-pricing-a-market-reference-for-2026
[sherlock-cost]: https://sherlock.xyz/post/smart-contract-audit-cost
[sherlock-engine]: https://sherlock.xyz/solutions/audit-engine
[sherlock-oct]: https://sherlock.xyz/post/audit-engine-october-2026-update
[zealynx]: https://www.zealynx.io/blogs/what-smart-contract-audits-actually-cost
[zealynx-2026]: https://www.zealynx.io/blogs/audit-pricing-2026
[spark]: https://www.spark.money/tools/smart-contract-audit-firm-comparison
[pashov]: https://pashov.com/
[pashov-dir]: https://web3connect.com/partner/pashov-audit-group
[cantina-reviews]: https://cantina.xyz/solutions/security-reviews
[base-hub]: https://docs.base.org/base-services-hub
[base-free]: https://base.org/blog/free-security-reviews
[immunefi-folks]: https://immunefi.com/audit-competition/audit-comp-folks-finance-staking-contracts/information/
[c4-immunefi]: https://x.com/immunefi/status/2054543436615647655
[c4-news]: https://financefeeds.com/code4rena-shuts-down-as-immunefi-takes-over-bug-bounty-programs/
[codehawks]: https://codehawks.cyfrin.io/c/2026-07-battlechain-confidence-pools/submissions
[hacken-grants]: https://hacken.io/services/superchain-audit-grants/
[op-s9]: https://gov.optimism.io/t/season-9-final-report/10685
[nm-s8]: https://www.nethermind.io/blog/how-to-apply-for-optimisms-season-8-audit-grant-and-secure-your-interop-ready-system
[ef-subsidy]: https://www.theblock.co/post/397427/ethereum-foundation-launches-1-million-crypto-security-subsidy-providing-access-to-over-20-audit-firms
[nm-subsidies]: https://www.nethermind.io/audit-subsidy-programs
