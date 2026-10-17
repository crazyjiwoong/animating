import type { AudioTrack } from '../types';

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
  const m = { data: out, rate };
  monoCache.set(buffer, m);
  return m;
}

/* ---------------------------------------------------------------- 시간 ↔ 프레임 */

export function audioTimeAtFrame(track: AudioTrack, frame: number, fps: number) {
  return (frame - track.startFrame) / fps + track.trim;
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

/** fromFrame 부터 untilFrame(제외)까지 재생. rate = 재생 속도 */
export function playAudioFrom(track: AudioTrack, fps: number, fromFrame: number, untilFrame: number, rate = 1) {
  stopAudio();
  if (track.muted) return;
  const ac = audioCtx();
  const src = ac.createBufferSource();
  src.buffer = track.buffer;
  src.playbackRate.value = rate;
  const gain = ac.createGain();
  gain.gain.value = track.volume;
  src.connect(gain).connect(ac.destination);
  const now = ac.currentTime + 0.02;
  const t = audioTimeAtFrame(track, fromFrame, fps);
  const tEnd = audioTimeAtFrame(track, untilFrame, fps);
  let when = now;
  let offset = t;
  if (t < track.trim) {
    // 음악 시작 전 구간은 실제 시간으로 기다린다
    when = now + (track.trim - t) / rate;
    offset = track.trim;
  }
  const dur = tEnd - offset;
  if (dur <= 0 || offset >= track.buffer.duration) return;
  src.start(when, offset, dur);
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

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
