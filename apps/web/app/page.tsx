import Link from "next/link";
import { GAMES } from "@/app/lib/games";

export default function HomePage() {
  return (
    <div>
      {/* Encabezado principal */}
      <section className="mb-10 text-center">
        <h1 className="bg-gradient-to-r from-[--color-accent] to-[--color-accent-2] bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
          Duelos 1v1 por dinero
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-400">
          Elegi un juego, poni tu apuesta en USDC y jugate el pozo contra otra
          persona. El ganador se lleva todo (menos la comision).
        </p>
      </section>

      {/* Cards de juegos */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((game) => {
          const isLive = game.status === "live";
          const card = (
            <div
              className={`group h-full rounded-2xl border border-[--color-border] bg-[--color-surface] p-6 transition ${
                isLive
                  ? "cursor-pointer hover:-translate-y-1 hover:border-[--color-accent]"
                  : "opacity-60"
              }`}
            >
              <div className="mb-4 text-5xl">{game.emoji}</div>
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-xl font-bold">{game.name}</h2>
                {!isLive && (
                  <span className="rounded-full bg-[--color-surface-2] px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    Pronto
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-[--color-accent-2]">
                {game.tagline}
              </p>
              <p className="mt-3 text-sm text-slate-400">{game.description}</p>
              {isLive && (
                <p className="mt-5 text-sm font-semibold text-[--color-accent] group-hover:underline">
                  Jugar →
                </p>
              )}
            </div>
          );

          return isLive ? (
            <Link key={game.id} href={`/game/${game.id}`}>
              {card}
            </Link>
          ) : (
            <div key={game.id}>{card}</div>
          );
        })}
      </section>
    </div>
  );
}
