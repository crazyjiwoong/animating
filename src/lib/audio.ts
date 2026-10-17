import type { AudioTrack, FrameSound } from '../types';

let ctx: AudioContext | null = null;
export function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const ab = await blob.arrayBuffer();
  return await audioCtx().decodeAudioData(ab);
}

/* ---------------------------------------------------------------- 모노 다운샘플 */

interface Mono {
  data: Float32Array;
  rate: number;
  /** 전체 트랙에서 가장 큰 구간 RMS (정규화 기준) */
  peakRms: number;
}
const monoCache = new WeakMap<AudioBuffer, Mono>();

export function getMono(buffer: AudioBuffer): Mono {
  const hit = monoCache.get(buffer);
  if (hit) return hit;
  const factor = Math.max(1, Math.round(buffer.sampleRate / 11025));
  const len = Math.floor(buffer.length / factor);
  const out = new Float32Array(len);
  const chs = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const norm = 1 / (factor * chs.length);
  for (let i = 0; i < len; i++) {
    let s = 0;
    const base = i * factor;
    for (const ch of chs) for (let k = 0; k < factor; k++) s += ch[base + k];
    out[i] = s * norm;
  }
  const rate = buffer.sampleRate / factor;
  // 50ms 블록 RMS 중 최대값
  const block = Math.round(rate * 0.05);
  let peakRms = 1e-6;
  for (let i = 0; i + block <= len; i += block) {
    let s = 0;
    for (let k = 0; k < block; k++) s += out[i + k] * out[i + k];
    peakRms = Math.max(peakRms, Math.sqrt(s / block));
  }
  const m = { data: out, rate, peakRms };
  monoCache.set(buffer, m);
  return m;
}

/* ---------------------------------------------------------------- 시간 ↔ 프레임 */

export function audioTimeAtFrame(track: AudioTrack, frame: number, fps: number) {
  return (frame - track.startFrame) / fps + track.trim;
}

/* ---------------------------------------------------------------- 음 이름 */

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KO = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'];
/** 12음 색상 (크로마 휠) */
export const NOTE_COLORS = [
  '#ff5d73', '#ff7f50', '#ffa940', '#ffd23f', '#c6e85a', '#5ee38c',
  '#3fd6c6', '#45b8ff', '#5b8cff', '#8b7bff', '#c06bff', '#ff6fd0',
];

export type NoteNaming = 'en' | 'ko';

export function freqToMidi(f: number) {
  return Math.round(69 + 12 * Math.log2(f / 440));
}
export function midiToFreq(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
export function noteName(midi: number, naming: NoteNaming = 'ko', withOctave = true) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  const n = naming === 'ko' ? KO[pc] : NAMES[pc];
  return withOctave ? `${n}${oct}` : n;
}
export function noteColor(midi: number) {
  return NOTE_COLORS[((midi % 12) + 12) % 12];
}
/** 정확한 음에서 몇 cent 벗어났는지 */
export function centsOff(f: number, midi: number) {
  return Math.round(1200 * Math.log2(f / midiToFreq(midi)));
}

/* ---------------------------------------------------------------- 피치 검출 (YIN) */

function yin(x: Float32Array, start: number, rate: number): { freq: number; clarity: number } | null {
  const W = 512;
  const tauMin = Math.max(2, Math.floor(rate / 1500));
  const tauMax = Math.min(Math.floor(rate / 55), 400);
  if (start < 0 || start + W + tauMax >= x.length) return null;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) {
      const v = x[start + j] - x[start + j + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  // 누적 평균 정규화
  const c = new Float32Array(tauMax + 1);
  c[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    c[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let best = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (c[tau] < 0.15) {
      while (tau + 1 <= tauMax && c[tau + 1] < c[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    let min = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (c[tau] < min) {
        min = c[tau];
        best = tau;
      }
    }
    if (min > 0.35) return null;
  }
  // 포물선 보간
  let tau = best;
  if (best > 1 && best < tauMax) {
    const a = c[best - 1],
      b = c[best],
      cc = c[best + 1];
    const den = a + cc - 2 * b;
    if (den !== 0) tau = best + (a - cc) / (2 * den);
  }
  return { freq: rate / tau, clarity: Math.max(0, Math.min(1, 1 - c[best])) };
}

const SILENT: FrameSound = { level: 0, freq: null, midi: null, clarity: 0 };

/**
 * 각 프레임 구간의 음량과 주요 음(기본 주파수)을 분석한다.
 * 반환 배열의 i 번째 = i 번째 프레임. 음악이 없는 구간은 null.
 */
export function analyzeFrames(track: AudioTrack, fps: number, frameCount: number): (FrameSound | null)[] {
  const mono = getMono(track.buffer);
  const { data, rate } = mono;
  const out: (FrameSound | null)[] = [];
  const dur = data.length / rate;
  for (let i = 0; i < frameCount; i++) {
    const t0 = audioTimeAtFrame(track, i, fps);
    const t1 = t0 + 1 / fps;
    if (t1 <= track.trim || t0 >= dur) {
      out.push(null);
      continue;
    }
    const s0 = Math.max(0, Math.floor(t0 * rate));
    const s1 = Math.min(data.length, Math.ceil(t1 * rate));
    let sum = 0;
    for (let k = s0; k < s1; k++) sum += data[k] * data[k];
    const rms = Math.sqrt(sum / Math.max(1, s1 - s0));
    const level = Math.min(1, rms / mono.peakRms);
    if (level < 0.04) {
      out.push({ ...SILENT, level });
      continue;
    }
    const mid = Math.floor(((t0 + t1) / 2) * rate) - 256;
    const p = yin(data, Math.max(0, mid), rate);
    if (!p) {
      out.push({ level, freq: null, midi: null, clarity: 0 });
      continue;
    }
    out.push({ level, freq: p.freq, midi: freqToMidi(p.freq), clarity: p.clarity });
  }
  return out;
}

/** 파형 표시용: 구간별 [min, max] */
export function framePeaks(track: AudioTrack, fps: number, frameCount: number, perFrame: number): Float32Array {
  const { data, rate } = getMono(track.buffer);
  const n = frameCount * perFrame;
  const out = new Float32Array(n * 2);
  const step = 1 / (fps * perFrame);
  for (let i = 0; i < n; i++) {
    const t0 = (i / perFrame - track.startFrame) / fps + track.trim;
    const s0 = Math.floor(t0 * rate);
    const s1 = Math.floor((t0 + step) * rate);
    let mn = 0,
      mx = 0;
    if (t0 >= track.trim) {
      for (let k = Math.max(0, s0); k < Math.min(data.length, s1); k++) {
        const v = data[k];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    out[i * 2] = mn;
    out[i * 2 + 1] = mx;
  }
  return out;
}

/* ---------------------------------------------------------------- 재생 */

let current: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

export function stopAudio() {
  if (current) {
    try {
      current.src.stop();
    } catch {
      /* 이미 멈춤 */
    }
    current.src.disconnect();
    current.gain.disconnect();
    current = null;
  }
}

/** fromFrame 부터 untilFrame(제외)까지 재생 */
export function playAudioFrom(track: AudioTrack, fps: number, fromFrame: number, untilFrame: number) {
  stopAudio();
  if (track.muted) return;
  const ac = audioCtx();
  const src = ac.createBufferSource();
  src.buffer = track.buffer;
  const gain = ac.createGain();
  gain.gain.value = track.volume;
  src.connect(gain).connect(ac.destination);
  const now = ac.currentTime + 0.02;
  const t = audioTimeAtFrame(track, fromFrame, fps);
  const total = (untilFrame - fromFrame) / fps;
  let when = now;
  let offset = t;
  if (t < track.trim) {
    when = now + (track.trim - t);
    offset = track.trim;
  }
  const remain = total - (when - now);
  if (remain <= 0 || offset >= track.buffer.duration) return;
  src.start(when, offset, remain);
  current = { src, gain };
}

/** 프레임 하나 분량만 짧게 재생 (스크럽) */
export function playFrameSlice(track: AudioTrack, fps: number, frame: number) {
  if (track.muted) return;
  const t = audioTimeAtFrame(track, frame, fps);
  if (t < track.trim || t >= track.buffer.duration) return;
  stopAudio();
  const ac = audioCtx();
  const src = ac.createBufferSource();
  src.buffer = track.buffer;
  const gain = ac.createGain();
  const len = Math.max(1 / fps, 0.06);
  const now = ac.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(track.volume, now + 0.005);
  gain.gain.setValueAtTime(track.volume, now + len - 0.01);
  gain.gain.linearRampToValueAtTime(0, now + len);
  src.connect(gain).connect(ac.destination);
  src.start(now, t, len);
  current = { src, gain };
}

/** 검출된 음을 순수 톤으로 들려준다 */
export function playTone(freq: number, dur = 0.35) {
  const ac = audioCtx();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const now = ac.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
