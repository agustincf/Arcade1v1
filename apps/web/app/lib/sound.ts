// Motor de sonido chiptune (estilo arcade) usando Web Audio API.
// No usa archivos: genera los sonidos en vivo, asi pegan con la estetica Y2K.
// La musica y los efectos arrancan recien con la primera interaccion del
// usuario (los navegadores bloquean el audio automatico).

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
let musicInterval: ReturnType<typeof setInterval> | null = null;
let step = 0;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 0.5;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

/** Reanuda el audio (llamar tras un gesto del usuario). */
export function ensureAudio() {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume();
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  vol = 0.2,
) {
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

function slide(
  f1: number,
  f2: number,
  dur: number,
  type: OscillatorType = "square",
  vol = 0.2,
) {
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
};

// Melodia de fondo (loop, tono bajo para no molestar).
const MELODY = [
  440, 0, 523, 659, 523, 0, 440, 0, 392, 0, 523, 587, 494, 0, 392, 0,
];
const BASS = [110, 0, 0, 0, 82, 0, 0, 0, 98, 0, 0, 0, 73, 0, 0, 0];

export function startMusic() {
  if (musicInterval) return;
  getCtx();
  step = 0;
  musicInterval = setInterval(() => {
    if (muted) return;
    const m = MELODY[step % MELODY.length];
    const b = BASS[step % BASS.length];
    if (m) tone(m, 0.18, "square", 0.05);
    if (b) tone(b, 0.22, "triangle", 0.08);
    step++;
  }, 165);
}

export function stopMusic() {
  if (musicInterval) {
    clearInterval(musicInterval);
    musicInterval = null;
  }
}

export function setMuted(m: boolean) {
  muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : 0.5;
}

export function isMuted() {
  return muted;
}
