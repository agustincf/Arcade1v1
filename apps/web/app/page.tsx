import Link from "next/link";
import { GAMES } from "@/app/lib/games";
import { BET_AMOUNTS } from "@/app/lib/config";

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="mb-8 text-center">
        <h1 className="font-pixel text-2xl text-[--color-accent] neon sm:text-4xl">
          JUGÁ. GANÁ. COBRÁ.
        </h1>
        <p className="font-screen mt-3 text-xl text-[--color-accent-2] neon-cyan">
          &gt;&gt; Retá a un rival 1v1 y jugate el pozo en USDC. Que gane el mejor &lt;&lt;
        </p>

        {/* Cinta de mesas disponibles */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {BET_AMOUNTS.map((b) => (
            <span key={b} className="chip">
              💰 {b} USDC
            </span>
          ))}
        </div>
      </section>

      {/* Tarjetas de juego (estilo "mercado") */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((game, i) => {
          const isLive = game.status === "live";
          const titleClass = i % 2 === 0 ? "win-title" : "win-title win-title--cyan";

          const inner = (
            <div className={`win h-full ${isLive ? "transition hover:-translate-y-1" : "opacity-70"}`}>
              <div className={titleClass}>
                <span>{game.name.toUpperCase()}.EXE</span>
                <span className="win-dots">
                  <span className="win-dot" />
                  <span className="win-dot" />
                  <span className="win-dot" />
                </span>
              </div>
              <div className="p-5">
                <div className="mb-3 text-center text-6xl">{game.emoji}</div>
                <div className="flex items-center justify-center gap-2">
                  {isLive ? (
                    <span className="chip">
                      <span className="blink">●</span> ABIERTO
                    </span>
                  ) : (
                    <span className="chip !text-slate-400">PRÓXIMAMENTE</span>
                  )}
                </div>
                <p className="font-screen mt-3 text-center text-lg text-slate-300">
                  {game.description}
                </p>
                {isLive && (
                  <div className="mt-5 text-center">
                    <span className="btn3d btn3d--magenta inline-block">
                      ► JUGAR Y GANAR
                    </span>
                  </div>
                )}
              </div>
            </div>
          );

          return isLive ? (
            <Link key={game.id} href={`/game/${game.id}`}>
              {inner}
            </Link>
          ) : (
            <div key={game.id}>{inner}</div>
          );
        })}
      </section>

      {/* Pie tipo "como funciona" retro */}
      <section className="win mt-8">
        <div className="win-title win-title--cyan">
          <span>COMO_FUNCIONA.TXT</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="font-screen grid grid-cols-1 gap-3 p-5 text-lg sm:grid-cols-3">
          <Step n="1" text="Elegí un juego y una mesa. Los dos ponen lo mismo en USDC." />
          <Step n="2" text="Te cruzamos con un rival. Cada uno juega su mejor intento." />
          <Step n="3" text="¿Más puntos que el rival? Te llevás el pozo entero." />
        </div>
        <p className="font-screen px-5 pb-4 text-sm text-slate-500">
          * La plataforma retiene una comisión del 10% del pozo. Si nadie aparece
          en 1 hora, se te devuelve todo.
        </p>
      </section>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-pixel text-sm text-[--color-gold]">{n}</span>
      <span className="text-slate-300">{text}</span>
    </div>
  );
}
