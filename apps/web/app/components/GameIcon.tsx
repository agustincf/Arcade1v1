// Iconos propios de los juegos (SVG neon), en vez de emojis del sistema.
// Sin estado: se puede usar en componentes de servidor o cliente.

function Sheen({ x, y, w, h, r }: { x: number; y: number; w: number; h: number; r: number }) {
  return <rect x={x} y={y} width={w} height={h * 0.45} rx={r} fill="rgba(255,255,255,0.45)" />;
}

function Blk({ x, y, s, c }: { x: number; y: number; s: number; c: string }) {
  return (
    <g>
      <rect x={x} y={y} width={s} height={s} rx={2} fill={c} />
      <Sheen x={x + 1} y={y + 1} w={s - 2} h={s - 2} r={1.5} />
    </g>
  );
}

export function GameIcon({ id, size = 48 }: { id: string; size?: number }) {
  const glow =
    id === "tetris"
      ? "#27e8ff"
      : id === "flappy"
        ? "#ffd23d"
        : id === "racing"
          ? "#39ff7a"
          : id === "2048"
            ? "#ffd23d"
            : id === "snake"
              ? "#39ff7a"
              : "#ff3df0";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      style={{ filter: `drop-shadow(0 0 4px ${glow})` }}
    >
      {id === "tetris" && (
        <>
          {/* Pieza S de bloques neon */}
          <Blk x={16} y={6} s={13} c="#ffd23d" />
          <Blk x={29} y={6} s={13} c="#27e8ff" />
          <Blk x={3} y={19} s={13} c="#c06bff" />
          <Blk x={16} y={19} s={13} c="#39ff7a" />
        </>
      )}

      {id === "flappy" && (
        <>
          <ellipse cx="24" cy="40" rx="11" ry="3" fill="rgba(0,0,0,0.25)" />
          <circle cx="23" cy="25" r="14" fill="#ffd23d" />
          <path d="M9 25 a14 14 0 0 1 28 0 z" fill="rgba(255,255,255,0.35)" />
          <ellipse cx="17" cy="28" rx="7" ry="5" fill="#ff9f1c" />
          <circle cx="30" cy="20" r="5" fill="#fff" />
          <circle cx="31" cy="20" r="2.4" fill="#0a0518" />
          <path d="M36 23 L46 25 L36 28 Z" fill="#ff7a00" />
        </>
      )}

      {id === "racing" && (
        <>
          <ellipse cx="24" cy="42" rx="13" ry="3" fill="rgba(0,0,0,0.25)" />
          {/* ruedas */}
          <rect x="9" y="12" width="6" height="11" rx="2" fill="#0a0510" />
          <rect x="33" y="12" width="6" height="11" rx="2" fill="#0a0510" />
          <rect x="9" y="28" width="6" height="11" rx="2" fill="#0a0510" />
          <rect x="33" y="28" width="6" height="11" rx="2" fill="#0a0510" />
          {/* carroceria */}
          <rect x="14" y="5" width="20" height="38" rx="8" fill="#39ff7a" />
          <rect x="15" y="6" width="18" height="14" rx="7" fill="rgba(255,255,255,0.4)" />
          {/* parabrisas y franjas */}
          <rect x="18" y="14" width="12" height="9" rx="3" fill="rgba(0,0,0,0.55)" />
          <rect x="22" y="26" width="4" height="14" fill="#0a3d1f" />
          {/* luces */}
          <rect x="16" y="39" width="6" height="3" rx="1" fill="#ff3b3b" />
          <rect x="26" y="39" width="6" height="3" rx="1" fill="#ff3b3b" />
        </>
      )}

      {id === "2048" && (
        <>
          {[
            { x: 4, y: 4, c: "#27e8ff", n: "2" },
            { x: 26, y: 4, c: "#ffd23d", n: "0" },
            { x: 4, y: 26, c: "#39ff7a", n: "4" },
            { x: 26, y: 26, c: "#ff3df0", n: "8" },
          ].map((t, i) => (
            <g key={i}>
              <rect x={t.x} y={t.y} width={18} height={18} rx={3} fill={t.c} />
              <rect
                x={t.x + 1}
                y={t.y + 1}
                width={16}
                height={7}
                rx={2}
                fill="rgba(255,255,255,0.4)"
              />
              <text
                x={t.x + 9}
                y={t.y + 14}
                textAnchor="middle"
                fontSize={13}
                fontWeight="bold"
                fontFamily="VT323, monospace"
                fill="#1a0033"
              >
                {t.n}
              </text>
            </g>
          ))}
        </>
      )}

      {id === "snake" && (
        <>
          {/* cuerpo de la serpiente */}
          {[
            [8, 30],
            [18, 30],
            [28, 30],
            [28, 20],
            [28, 10],
            [18, 10],
          ].map(([x, y], i) => (
            <rect key={i} x={x} y={y} width={10} height={10} rx={2} fill="#39ff7a" />
          ))}
          {/* cabeza */}
          <rect x={8} y={10} width={10} height={10} rx={2} fill="#b6ff3d" />
          <rect x={10} y={12} width={2} height={2} fill="#0a0518" />
          {/* comida */}
          <circle cx={40} cy={40} r={4} fill="#ff3df0" />
        </>
      )}

      {id === "invaders" && (
        <>
          {/* invader clasico en pixeles */}
          {(() => {
            const P = ["00100100", "01111110", "11011011", "11111111", "10111101", "10100101"];
            const s = 5;
            const ox = 4;
            const oy = 8;
            const cells: React.ReactNode[] = [];
            P.forEach((rowStr, r) =>
              rowStr.split("").forEach((ch, c) => {
                if (ch === "1")
                  cells.push(
                    <rect
                      key={`${r}-${c}`}
                      x={ox + c * s}
                      y={oy + r * s}
                      width={s}
                      height={s}
                      fill="#ff3df0"
                    />,
                  );
              }),
            );
            return cells;
          })()}
        </>
      )}

      {id === "coming-soon" && (
        <>
          <path d="M24 4 L29 19 L44 24 L29 29 L24 44 L19 29 L4 24 L19 19 Z" fill="#ff3df0" />
          <path d="M24 4 L29 19 L44 24 L24 24 Z" fill="rgba(255,255,255,0.4)" />
        </>
      )}
    </svg>
  );
}
