// Every sound is synthesized. Wooden clacks for the pieces (X a little higher than O), a whoosh for the tape,
// stingers for win, loss and draw, and a slow warm loop under it all (quieter on menus). The platform applies volume and mute.

let ctx = null;
let master = null;
let sfxGain = null;
let musicGain = null;
let noiseBuf = null;
let started = false;
let scene = 'menu';
let seqTimer = 0;
let nextTime = 0;
let step = 0;

const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;

export function startAudio() {
  if (started) {
    // iPhones can leave the context interrupted after a call or a lock: any tap wakes it.
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    return;
  }
  if (!AC) return;
  try {
    ctx = new AC();
  } catch {
    return;
  }
  started = true;
  master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 1;
  sfxGain.connect(master);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0;
  musicGain.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  nextTime = ctx.currentTime + 0.1;
  seqTimer = setInterval(schedule, 90);
  setScene(scene);
}

const live = () => !!ctx && ctx.state === 'running';

function env(g, t, attack, peak, decay) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(freq, { type = 'sine', at = 0, dur = 0.2, vol = 0.25, attack = 0.004, slide = 0, out = sfxGain, filter = 0 } = {}) {
  if (!live()) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  env(g, t, attack, vol, dur);
  let node = o;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

function noise({ at = 0, dur = 0.1, vol = 0.2, freq = 2000, q = 1, type = 'bandpass', sweep = 0, out = sfxGain, attack = 0.002 } = {}) {
  if (!live()) return;
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, attack, vol, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + attack + dur + 0.05);
}

// ------------------------------------------------------------------ effects

/** A piece lands: a wooden clack, X a little brighter than O. */
export function place(mark) {
  if (!live()) return;
  const x = mark === 'x';
  noise({ dur: 0.05, vol: 0.34, freq: x ? 2600 : 1700, q: 2.4 });
  tone(x ? 230 : 165, { type: 'sine', dur: 0.09, vol: 0.34, slide: 0.55 });
  tone(x ? 880 : 620, { type: 'triangle', dur: 0.05, vol: 0.07, at: 0.004 });
  // the little settle after it lands
  noise({ at: 0.09, dur: 0.03, vol: 0.1, freq: x ? 3200 : 2300, q: 3 });
}

export function lift() {
  tone(520, { type: 'sine', dur: 0.05, vol: 0.05 });
}

export function tap() {
  noise({ dur: 0.03, vol: 0.14, freq: 2200, q: 3 });
  tone(400, { type: 'sine', dur: 0.05, vol: 0.12, slide: 0.7 });
}

export function deny() {
  tone(130, { type: 'square', dur: 0.12, vol: 0.09, filter: 600 });
  tone(110, { type: 'square', dur: 0.14, vol: 0.09, at: 0.09, filter: 500 });
}

export function undo() {
  tone(520, { type: 'triangle', dur: 0.1, vol: 0.12, slide: 0.55 });
  noise({ dur: 0.08, vol: 0.08, freq: 1500, q: 1 });
}

export function hint() {
  tone(988, { type: 'sine', dur: 0.35, vol: 0.14 });
  tone(1319, { type: 'sine', dur: 0.4, vol: 0.1, at: 0.09 });
}

/** The tape being laid across the winning line. */
export function whoosh() {
  noise({ dur: 0.55, vol: 0.24, freq: 350, sweep: 7, q: 0.9, attack: 0.05 });
  tone(300, { type: 'sawtooth', dur: 0.4, vol: 0.04, slide: 3, filter: 1200 });
}

/** A score tile turning over. */
export function flip(n = 1) {
  for (let i = 0; i < n; i++) {
    noise({ at: i * 0.045, dur: 0.025, vol: 0.12, freq: 3500, q: 4 });
    noise({ at: i * 0.045 + 0.02, dur: 0.03, vol: 0.09, freq: 2400, q: 4 });
  }
}

function arp(notes, { type = 'triangle', gap = 0.1, dur = 0.35, vol = 0.18 } = {}) {
  notes.forEach((f, i) => tone(f, { type, at: i * gap, dur, vol, filter: 3000 }));
}

export function win() {
  arp([523.25, 659.25, 783.99, 1046.5], { gap: 0.09, dur: 0.5, vol: 0.2 });
  tone(261.63, { type: 'sine', dur: 0.9, vol: 0.2, at: 0.05 });
  tone(1568, { type: 'sine', dur: 0.5, vol: 0.06, at: 0.4 });
}

export function lose() {
  arp([392, 349.23, 311.13, 261.63], { gap: 0.13, dur: 0.4, vol: 0.16, type: 'triangle' });
  tone(98, { type: 'sine', dur: 0.9, vol: 0.16, at: 0.1 });
}

export function drawGame() {
  arp([440, 440, 392], { gap: 0.16, dur: 0.3, vol: 0.14 });
}

export function fanfare() {
  arp([523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5], { gap: 0.1, dur: 0.6, vol: 0.2 });
  tone(130.81, { type: 'sine', dur: 1.4, vol: 0.2, at: 0.05 });
  tone(196, { type: 'sine', dur: 1.4, vol: 0.14, at: 0.05 });
}

export function begin() {
  arp([392, 523.25, 659.25], { gap: 0.08, dur: 0.25, vol: 0.14 });
}

export function tick() {
  tone(1200, { type: 'sine', dur: 0.04, vol: 0.08 });
}

// ------------------------------------------------------------------ music

const CHORDS = [
  { root: 48, notes: [60, 64, 67, 71] }, // Cmaj7
  { root: 45, notes: [57, 60, 64, 67] }, // Am7
  { root: 50, notes: [57, 60, 62, 65] }, // Dm7
  { root: 43, notes: [55, 59, 62, 65] }, // G7
];
const MELODY = [
  [76, 0, 0, 79, 0, 0, 74, 0],
  [72, 0, 76, 0, 0, 0, 0, 0],
  [77, 0, 0, 74, 0, 72, 0, 0],
  [71, 0, 74, 0, 79, 0, 0, 0],
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BPM = 76;
const EIGHTH = 60 / BPM / 2;

function schedule() {
  if (!live()) return;
  const horizon = ctx.currentTime + 0.35;
  while (nextTime < horizon) {
    playStep(step, nextTime);
    // a lazy swing on the off-beats
    nextTime += EIGHTH * (step % 2 === 0 ? 1.12 : 0.88);
    step = (step + 1) % 64;
  }
}

function voice(freq, t, dur, vol, type, cutoff) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = type;
  o.frequency.value = freq;
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.06, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(musicGain);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function playStep(s, t) {
  const bar = Math.floor(s / 8) % 4;
  const beat = s % 8;
  const chord = CHORDS[bar];
  const dt = Math.max(0, t - ctx.currentTime);
  void dt;
  if (beat === 0) {
    // soft pad
    for (const n of chord.notes) voice(mtof(n), t, EIGHTH * 8.2, 0.035, 'triangle', 900);
    voice(mtof(chord.root), t, EIGHTH * 3.6, 0.2, 'sine', 400);
    kick(t, 0.5);
  }
  if (beat === 4) {
    voice(mtof(chord.root + (bar === 3 ? 7 : 0)), t, EIGHTH * 2.8, 0.14, 'sine', 400);
    kick(t, 0.32);
  }
  if (beat === 2 || beat === 6) snare(t, beat === 6 ? 0.9 : 1);
  if (beat % 2 === 1) hat(t, 0.5);
  else if (beat % 4 === 0) hat(t, 0.8);
  // rhodes-ish plucks
  if (beat === 1 || beat === 3 || beat === 5 || beat === 7) {
    const n = chord.notes[(beat * 3 + bar) % chord.notes.length] + 12;
    voice(mtof(n), t, EIGHTH * 1.8, 0.05, 'sine', 2200);
  }
  const m = MELODY[bar][beat];
  if (m && (Math.floor(s / 32) % 2 === 1 || bar % 2 === 1)) voice(mtof(m), t, EIGHTH * 2.2, 0.06, 'triangle', 2600);
}

function kick(t, v) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g).connect(musicGain);
  o.start(t);
  o.stop(t + 0.25);
}

function noiseAt(t, dur, vol, freq, type) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(musicGain);
  s.start(t, Math.random() * 0.4);
  s.stop(t + dur + 0.03);
}

function snare(t, v) {
  noiseAt(t, 0.14, 0.16 * v, 1800, 'bandpass');
}

function hat(t, v) {
  noiseAt(t, 0.04, 0.07 * v, 7000, 'highpass');
}

/** 'menu' is quiet, 'play' is the full loop, 'off' fades it out. */
export function setScene(name) {
  scene = name;
  if (!live() || !musicGain) return;
  const target = name === 'play' ? 0.5 : name === 'menu' ? 0.26 : 0;
  musicGain.gain.cancelScheduledValues(ctx.currentTime);
  musicGain.gain.setTargetAtTime(target, ctx.currentTime, 0.6);
}

/** Duck the music under a stinger. */
export function duck(seconds = 1.6) {
  if (!live() || !musicGain) return;
  const base = scene === 'play' ? 0.5 : 0.26;
  const t = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(t);
  musicGain.gain.setTargetAtTime(base * 0.2, t, 0.05);
  musicGain.gain.setTargetAtTime(base, t + seconds, 0.5);
}

export function stopAudio() {
  clearInterval(seqTimer);
}
