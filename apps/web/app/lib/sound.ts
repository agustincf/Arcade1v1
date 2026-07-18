// Efectos de sonido chiptune (estilo arcade) usando Web Audio API.
// Sin musica de fondo: solo SFX dentro de los juegos. No usa archivos.
// El audio se "desbloquea" con la primera interaccion del usuario.

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
const volume = 0.6; // volumen base de los SFX; el usuario regula desde su SO

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : volume;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

/** Reanuda el audio (llamar tras un gesto del usuario). */
export function ensureAudio() {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume();
}

function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.2) {
  const c = getCtx();
  if (!c || muted || !masterGain) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g);
  g.connect(masterGain);
  o.start();
  o.stop(c.currentTime + dur + 0.02);
}

function slide(f1: number, f2: number, dur: number, type: OscillatorType = "square", vol = 0.2) {
  const c = getCtx();
  if (!c || muted || !masterGain) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(f2, c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g);
  g.connect(masterGain);
  o.start();
  o.stop(c.currentTime + dur + 0.02);
}

/** Efectos de sonido, representativos de cada accion. */
export const sfx = {
  flap: () => slide(430, 780, 0.13, "square", 0.18), // aletear (sube)
  rotate: () => tone(680, 0.06, "square", 0.17), // rotar pieza (click)
  move: () => tone(320, 0.05, "triangle", 0.18), // mover auto (blip)
  drop: () => slide(500, 160, 0.1, "square", 0.16), // caida dura tetris
  clear: () => {
    tone(880, 0.09, "square", 0.2);
    setTimeout(() => tone(1175, 0.11, "square", 0.2), 80);
  },
  crash: () => slide(300, 70, 0.32, "sawtooth", 0.22), // choque
  // Space Invaders
  shoot: () => slide(920, 240, 0.07, "square", 0.12), // pew del cañon
  zap: () => slide(1400, 120, 0.13, "sawtooth", 0.16), // alien destruido
  ufoHit: () => {
    // arpegio de bonus
    tone(660, 0.08, "square", 0.2);
    setTimeout(() => tone(880, 0.08, "square", 0.2), 70);
    setTimeout(() => tone(1320, 0.12, "square", 0.2), 140);
  },
  hitPlayer: () => slide(220, 55, 0.3, "sawtooth", 0.22), // perder una vida
  beat: (n: number) => tone(n ? 98 : 82, 0.09, "triangle", 0.09), // latido de la formacion
  ufoBlip: () => tone(1040, 0.04, "sine", 0.05), // zumbido del OVNI
};

export function setMuted(m: boolean) {
  muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : volume;
}

export function isMuted() {
  return muted;
}
