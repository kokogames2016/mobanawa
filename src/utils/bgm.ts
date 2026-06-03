/**
 * BGM generator using Web Audio API (no audio files required)
 * 120 BPM, C→G→Am→F chord progression, 4-bar seamless loop
 */

let _ac: AudioContext | null = null;
let masterGain: GainNode | null = null;
let reverbGain: GainNode | null = null;
let reverbNode: ConvolverNode | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let nextNoteTime = 0;
let currentStep = 0;
let _running = false;
let _volume = 0.25;
let _muted = false;

// ─── Timing ───────────────────────────────────────────────────────────────────
const BPM = 120;
const QUARTER = 60 / BPM;        // 0.5 s
const SIXTEENTH = QUARTER / 4;   // 0.125 s
const BEATS_PER_BAR = 16;        // sixteenth notes per bar
const NUM_BARS = 4;
const TOTAL_STEPS = BEATS_PER_BAR * NUM_BARS; // 64

// ─── Chord data ───────────────────────────────────────────────────────────────
// tones: arpeggio frequencies (as specified)
// root:  bass note (one octave lower)
const CHORDS = [
  { tones: [261, 330, 392], root: 131 },  // C  – C3 bass
  { tones: [392, 494, 587], root: 196 },  // G  – G3 bass
  { tones: [440, 523, 659], root: 220 },  // Am – A3 bass
  { tones: [349, 440, 523], root: 175 },  // F  – F3 bass
] as const;

// ─── Lookahead scheduler ──────────────────────────────────────────────────────
const LOOKAHEAD   = 0.15; // s — how far ahead to schedule
const TICK_MS     = 25;   // ms — scheduler interval

// ─── AudioContext helpers ─────────────────────────────────────────────────────
function getAC(): AudioContext {
  if (!_ac) {
    _ac = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (_ac.state === 'suspended') void _ac.resume();
  return _ac;
}

function buildReverb(ac: AudioContext): ConvolverNode {
  const conv = ac.createConvolver();
  const dur  = 1.8; // reverb tail in seconds
  const len  = Math.floor(ac.sampleRate * dur);
  const buf  = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
  }
  conv.buffer = buf;
  return conv;
}

// ─── Note schedulers ─────────────────────────────────────────────────────────
function scheduleArpeggio(freq: number, time: number) {
  const ac = getAC();
  if (!masterGain) return;

  const dur = SIXTEENTH * 0.82;   // slightly shorter for articulation
  const vol = 0.13;

  // Two triangle oscillators slightly detuned for thickness
  for (const detune of [-6, 6]) {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value    = detune;
    osc.connect(gain);
    gain.connect(masterGain);      // dry
    if (reverbNode) gain.connect(reverbNode); // pre-reverb send

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.start(time);
    osc.stop(time + dur + 0.01);
  }
}

function scheduleBass(freq: number, time: number) {
  const ac = getAC();
  if (!masterGain) return;

  const dur = QUARTER * 0.75; // quarter note, slightly clipped
  const vol = 0.22;

  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(masterGain);

  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(vol, time + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

  osc.start(time);
  osc.stop(time + dur + 0.01);
}

// ─── Per-step scheduler ───────────────────────────────────────────────────────
function scheduleStep(step: number, time: number) {
  const chordIdx = Math.floor(step / BEATS_PER_BAR); // 0–3
  const chord    = CHORDS[chordIdx];

  // Ascending arpeggio: cycle chord tones by 16th-note position within bar
  const posInBar = step % BEATS_PER_BAR; // 0–15
  const toneIdx  = posInBar % chord.tones.length; // 0-2
  scheduleArpeggio(chord.tones[toneIdx], time);

  // Bass on every quarter note (every 4 sixteenth notes)
  if (posInBar % 4 === 0) {
    scheduleBass(chord.root, time);
  }
}

function tick() {
  const ac = getAC();
  while (nextNoteTime < ac.currentTime + LOOKAHEAD) {
    scheduleStep(currentStep, nextNoteTime);
    currentStep  = (currentStep + 1) % TOTAL_STEPS;
    nextNoteTime += SIXTEENTH;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function startBGM(volume = 0.25, muted = false) {
  if (_running) return;
  _running = true;
  _volume  = volume;
  _muted   = muted;

  const ac = getAC();

  // Master gain
  masterGain = ac.createGain();
  masterGain.gain.value = muted ? 0 : volume;
  masterGain.connect(ac.destination);

  // Reverb chain (wet signal only)
  reverbNode = buildReverb(ac);
  reverbGain = ac.createGain();
  reverbGain.gain.value = 0.18; // subtle — 18% wet
  reverbNode.connect(reverbGain);
  reverbGain.connect(masterGain);

  // Kick off scheduler
  currentStep  = 0;
  nextNoteTime = ac.currentTime + 0.05;
  schedulerTimer = setInterval(tick, TICK_MS);
}

export function stopBGM() {
  if (!_running) return;
  _running = false;

  if (schedulerTimer !== null) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }

  // Fade out to avoid click
  if (masterGain && _ac) {
    const now = _ac.currentTime;
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, now + 0.3);
    setTimeout(() => {
      masterGain?.disconnect();
      reverbGain?.disconnect();
      reverbNode?.disconnect();
      masterGain = null;
      reverbGain = null;
      reverbNode = null;
    }, 400);
  }
}

export function setBGMVolume(volume: number) {
  _volume = volume;
  if (!masterGain || !_ac || _muted) return;
  masterGain.gain.setTargetAtTime(volume, _ac.currentTime, 0.05);
}

export function setBGMMuted(muted: boolean) {
  _muted = muted;
  if (!masterGain || !_ac) return;
  masterGain.gain.setTargetAtTime(muted ? 0 : _volume, _ac.currentTime, 0.05);
}
