// Agente mínimo: empareja, juega 2048 y muestra el resultado. Necesita el árbitro
// corriendo (local o publicado). Correr con: ARBITER_URL=... npm run example -w @arcade1v1/agent-sdk
import { createAgent } from "../src/index.js";

const arbiterUrl = process.env.ARBITER_URL ?? "http://localhost:4000";

async function main() {
  const agent = createAgent({ arbiterUrl });
  console.log("Agente:", agent.address);
  const res = await agent.playAndSubmit({ game: "2048", stake: 5 });
  // El árbitro indexa por dirección en minúsculas.
  console.log("Estado:", res.status, "· tu score:", res.scores[agent.address.toLowerCase()]);
  if (res.status === "settled") {
    console.log(
      "Resultado:",
      res.winner?.toLowerCase() === agent.address.toLowerCase() ? "GANASTE" : "perdiste",
      "· tu score:",
      res.yourScore,
      "· rival:",
      res.rivalScore,
    );
  } else {
    console.log("Esperando rival. Volvé a consultar el match", res.matchId, "más tarde.");
  }
}

main().catch((e) => {
  console.error("Error:", (e as Error).message);
  console.error("¿Está corriendo el árbitro en", arbiterUrl, "?");
  process.exit(1);
});
