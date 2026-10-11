// Sons sintetizados com WebAudio: nenhum arquivo de áudio.
// O contexto só pode começar depois de um clique (regra dos navegadores).
let ctx = null, master = null, noiseBuf = null, muted = false;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.55; return muted; }

const now = () => ctx.currentTime;
function env(gainNode, t0, attack, peak, decay) {
  const g = gainNode.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + attack);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}
// ruído filtrado com varredura de frequência
function noise({ type = 'bandpass', f0 = 800, f1 = 800, q = 1, dur = 0.2, peak = 0.5, attack = 0.005, delay = 0 }) {
  if (!ctx || muted) return;
  const t0 = now() + delay;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); env(g, t0, attack, peak, dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0, Math.random() * 0.5); src.stop(t0 + attack + dur + 0.05);
}
function tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.2, peak = 0.3, attack = 0.003, delay = 0 }) {
  if (!ctx || muted) return;
  const t0 = now() + delay;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); env(g, t0, attack, peak, dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + attack + dur + 0.05);
}

export const sfx = {
  swing(heavy = false) {
    noise({ type: 'bandpass', f0: heavy ? 300 : 500, f1: heavy ? 1400 : 2600, q: 1.2, dur: heavy ? 0.35 : 0.22, peak: heavy ? 0.5 : 0.35, attack: 0.04 });
  },
  hit(kind = 'bone', crit = false) {
    tone({ type: 'sine', f0: 140, f1: 45, dur: 0.16, peak: 0.7 });                       // impacto grave
    if (kind === 'bone') {
      noise({ type: 'highpass', f0: 2200, f1: 1200, dur: 0.07, peak: 0.6 });
      for (let i = 0; i < 3; i++) tone({ type: 'square', f0: 900 + Math.random() * 700, f1: 500, dur: 0.03, peak: 0.08, delay: 0.015 * i });
    } else {
      noise({ type: 'lowpass', f0: 900, f1: 200, dur: 0.12, peak: 0.6 });
    }
    if (crit) { tone({ type: 'triangle', f0: 2400, f1: 2300, dur: 0.45, peak: 0.12 }); tone({ type: 'sine', f0: 3600, f1: 3500, dur: 0.3, peak: 0.06 }); }
  },
  heavyImpact() {
    tone({ type: 'sine', f0: 90, f1: 30, dur: 0.5, peak: 0.9 });
    noise({ type: 'lowpass', f0: 1200, f1: 80, dur: 0.6, peak: 0.7 });
  },
  hurt() {
    tone({ type: 'triangle', f0: 1300, f1: 1250, dur: 0.35, peak: 0.12 });              // metal da armadura
    tone({ type: 'sine', f0: 1950, f1: 1900, dur: 0.25, peak: 0.07 });
    noise({ type: 'lowpass', f0: 700, f1: 150, dur: 0.15, peak: 0.5 });
  },
  dodge() { noise({ type: 'lowpass', f0: 1800, f1: 300, dur: 0.3, peak: 0.35, attack: 0.03 }); },
  shatter() {
    for (let i = 0; i < 9; i++) {
      const d = Math.random() * 0.35;
      noise({ type: 'highpass', f0: 1800 + Math.random() * 1500, f1: 900, dur: 0.05, peak: 0.25, delay: d });
      tone({ type: 'square', f0: 600 + Math.random() * 900, f1: 300, dur: 0.04, peak: 0.05, delay: d });
    }
  },
  yelp() { tone({ type: 'sawtooth', f0: 900, f1: 1400, dur: 0.12, peak: 0.12 }); tone({ type: 'sawtooth', f0: 1300, f1: 600, dur: 0.18, peak: 0.1, delay: 0.1 }); },
  levelUp() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.3, peak: 0.15, delay: i * 0.09 })); },
  pickup() { tone({ type: 'sine', f0: 880, f1: 1320, dur: 0.12, peak: 0.15 }); },
};
