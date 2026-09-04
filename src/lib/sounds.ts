/**
 * Sons curtos de feedback, sintetizados com Web Audio (sem arquivo de audio).
 *
 * - `primeAudio()` deve ser chamado dentro de um clique do usuario (por
 *   exemplo no botao "Iniciar fila"): navegadores so liberam audio depois de
 *   um gesto, e o AudioContext criado ali fica valido para tocar depois.
 * - A preferencia de som fica em localStorage (`optmos-sound`), ligada por
 *   padrao. Sem suporte a Web Audio, tudo vira no-op.
 */

const STORAGE_KEY = "optmos-sound";

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  return context;
}

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // sem storage: fica so na sessao
  }
}

/** Cria e libera o AudioContext. Chamar dentro de um gesto do usuario. */
export function primeAudio(): void {
  const ctx = getContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
}

interface Note {
  frequency: number;
  /** Instante de inicio, em segundos, relativo ao comeco do som. */
  at: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
}

function play(notes: Note[]): void {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

  const master = ctx.createGain();
  master.gain.value = 1.0;
  master.connect(ctx.destination);
  const start = ctx.currentTime + 0.01;

  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type ?? "sine";
    osc.frequency.value = note.frequency;

    const t0 = start + note.at;
    const t1 = t0 + note.duration;
    const peak = note.gain ?? 0.32;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
}

/**
 * Fila concluida: "pi-li-lim", tres notas curtas subindo (E6, G6, C7) com
 * timbre de sininho (fundamental + oitava mais fraca), a ultima sustentada.
 */
export function playQueueDone(): void {
  const bell = (frequency: number, at: number, duration: number, gain: number): Note[] => [
    { frequency, at, duration, gain },
    { frequency: frequency * 2, at, duration: duration * 0.7, gain: gain * 0.35, type: "triangle" },
  ];
  play([
    ...bell(1318.51, 0, 0.16, 0.42),
    ...bell(1567.98, 0.13, 0.16, 0.42),
    ...bell(2093.0, 0.26, 0.75, 0.48),
  ]);
}

/** Uma linha otimizada: um tique discreto. */
export function playRowDone(): void {
  play([
    { frequency: 1318.51, at: 0, duration: 0.1, gain: 0.26 },
    { frequency: 2637.02, at: 0, duration: 0.07, gain: 0.09, type: "triangle" },
  ]);
}

/** Fila pausada por chave, saldo ou cota: duas notas descendentes. */
export function playAttention(): void {
  play([
    { frequency: 587.33, at: 0, duration: 0.16, gain: 0.3 },
    { frequency: 440, at: 0.18, duration: 0.3, gain: 0.3 },
  ]);
}
