let _ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!_ctx) {
    _ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function createReverb(ac: AudioContext, decay = 0.5): ConvolverNode {
  const conv = ac.createConvolver();
  const len = Math.floor(ac.sampleRate * decay);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
  }
  conv.buffer = buf;
  return conv;
}

function playTone(
  type: OscillatorType,
  freqStart: number,
  freqEnd: number,
  dur: number,
  vol = 0.35,
  freqMid?: number,
) {
  try {
    const ac = getCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, ac.currentTime);
    if (freqMid !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(freqMid, ac.currentTime + dur / 2);
      osc.frequency.exponentialRampToValueAtTime(freqEnd, ac.currentTime + dur);
    } else {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, ac.currentTime + dur);
    }
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.start();
    osc.stop(ac.currentTime + dur);
  } catch { /* ignore */ }
}

/** カード通常配置：短いクリック音（100ms、sine波、200Hz→100Hz） */
export function playCardPlace() {
  playTone('sine', 200, 100, 0.1, 0.4);
}

/** SA配置：少し派手な音（300ms、sawtooth波、300Hz→600Hz→300Hz） */
export function playSAPlace() {
  playTone('sawtooth', 300, 300, 0.3, 0.3, 600);
}

/** パス：低めの短音（150ms、sine波、300Hz→200Hz） */
export function playPass() {
  playTone('sine', 300, 200, 0.15, 0.3);
}

/** リセット：下降音（200ms、sine波、440Hz→220Hz） */
export function playReset() {
  playTone('sine', 440, 220, 0.2, 0.4);
}

/** 衝突（石）：金属的なキーン音（3重sine波、下降スウィープ、500ms） */
export function playCollision() {
  try {
    const ac = getCtx();
    for (const [freq, vol] of [[1200, 0.28], [1550, 0.22], [950, 0.18]] as const) {
      const osc  = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.45, ac.currentTime + 0.5);
      gain.gain.setValueAtTime(vol, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
      osc.start();
      osc.stop(ac.currentTime + 0.5);
    }
  } catch { /* ignore */ }
}

/** SPポイント蓄積：明るい上昇音（400ms、triangle波、440Hz→880Hz、リバーブあり） */
export function playSPGain() {
  try {
    const ac = getCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const reverb = createReverb(ac, 0.6);
    const wetGain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);   // dry
    gain.connect(reverb);
    reverb.connect(wetGain);
    wetGain.connect(ac.destination); // wet
    wetGain.gain.setValueAtTime(0.35, ac.currentTime);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ac.currentTime + 0.4);
    gain.gain.setValueAtTime(0.4, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.4);
    osc.start();
    osc.stop(ac.currentTime + 0.4);
  } catch { /* ignore */ }
}
