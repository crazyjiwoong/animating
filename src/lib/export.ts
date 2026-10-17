import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Project } from '../types';
import { createCanvas, ctx2d, canvasToBlob } from './canvas';
import { renderFrame } from './render';
import { audioCtx, audioTimeAtFrame } from './audio';

export interface VideoFormat {
  id: string;
  label: string;
  mime: string;
  ext: string;
}

const CANDIDATES: VideoFormat[] = [
  { id: 'mp4-h264', label: 'MP4 (H.264)', mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', ext: 'mp4' },
  { id: 'mp4', label: 'MP4', mime: 'video/mp4', ext: 'mp4' },
  { id: 'webm-vp9', label: 'WebM (VP9)', mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { id: 'webm', label: 'WebM (VP8)', mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
];

export function supportedVideoFormats(): VideoFormat[] {
  if (typeof MediaRecorder === 'undefined') return [];
  const out = CANDIDATES.filter((f) => MediaRecorder.isTypeSupported(f.mime));
  // 같은 확장자 중 첫 번째만
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.ext) ? false : (seen.add(f.ext), true)));
}

export interface ExportOptions {
  scale: number;
  loops: number;
  withAudio: boolean;
  background: string;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

function even(n: number) {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * MediaRecorder 로 실시간 녹화한다. 프레임마다 requestFrame 으로 정확히 한 장씩 밀어 넣고,
 * 음악은 같은 AudioContext 시계에 맞춰 재생한다.
 */
export async function exportVideo(p: Project, fmt: VideoFormat, opts: ExportOptions): Promise<Blob> {
  const w = even(p.width * opts.scale);
  const h = even(p.height * opts.scale);
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas);
  const totalFrames = p.frames.length * Math.max(1, opts.loops);
  const draw = (i: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(w / p.width, 0, 0, h / p.height, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    renderFrame(ctx, p, i % p.frames.length, { fallbackBackground: opts.background });
  };
  draw(0);

  const stream = canvas.captureStream(0);
  const vtrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const ac = audioCtx();
  let audioNodes: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  const useAudio = opts.withAudio && p.audio && !p.audio.muted;
  let dest: MediaStreamAudioDestinationNode | null = null;
  if (useAudio) {
    dest = ac.createMediaStreamDestination();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }

  const rec = new MediaRecorder(stream, {
    mimeType: fmt.mime,
    videoBitsPerSecond: Math.min(16_000_000, Math.round(w * h * p.fps * 0.25)),
    audioBitsPerSecond: 192_000,
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()));

  rec.start(250);
  vtrack.requestFrame();
  // 녹화가 실제로 시작될 때까지 잠깐 기다린다
  await new Promise((r) => setTimeout(r, 60));
  const t0 = ac.currentTime + 0.05;

  if (useAudio && dest && p.audio) {
    const a = p.audio;
    for (let loop = 0; loop < Math.max(1, opts.loops); loop++) {
      const src = ac.createBufferSource();
      src.buffer = a.buffer;
      const gain = ac.createGain();
      gain.gain.value = a.volume;
      src.connect(gain).connect(dest);
      const loopStart = t0 + (loop * p.frames.length) / p.fps;
      const startAt = audioTimeAtFrame(a, 0, p.fps);
      let when = loopStart;
      let offset = startAt;
      if (startAt < a.trim) {
        when += a.trim - startAt;
        offset = a.trim;
      }
      const dur = p.frames.length / p.fps - (when - loopStart);
      if (dur > 0 && offset < a.buffer.duration) {
        src.start(when, offset, dur);
        audioNodes.push({ src, gain });
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    let last = -1;
    const tick = () => {
      if (opts.signal?.aborted) {
        reject(new DOMException('취소됨', 'AbortError'));
        return;
      }
      const t = ac.currentTime - t0;
      const i = Math.floor(t * p.fps);
      if (i >= totalFrames) {
        resolve();
        return;
      }
      if (i >= 0 && i !== last) {
        last = i;
        draw(i);
        vtrack.requestFrame();
        opts.onProgress?.(i / totalFrames);
      }
      // rAF 는 탭이 가려지면 멈추므로 타이머로 돈다
      setTimeout(tick, 4);
    };
    tick();
  }).finally(() => {
    audioNodes.forEach((n) => {
      try {
        n.src.stop();
      } catch {
        /* noop */
      }
      n.src.disconnect();
      n.gain.disconnect();
    });
    audioNodes = [];
  });

  // 마지막 프레임이 1프레임만큼 보이도록 대기
  await new Promise((r) => setTimeout(r, 1000 / p.fps));
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  opts.onProgress?.(1);
  return new Blob(chunks, { type: fmt.mime.split(';')[0] });
}

export async function exportGif(p: Project, opts: Omit<ExportOptions, 'withAudio'>): Promise<Blob> {
  const w = Math.max(1, Math.round(p.width * opts.scale));
  const h = Math.max(1, Math.round(p.height * opts.scale));
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas, { willReadFrequently: true });
  const gif = GIFEncoder();
  const delay = Math.round(1000 / p.fps);
  for (let i = 0; i < p.frames.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('취소됨', 'AbortError');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(w / p.width, 0, 0, h / p.height, 0, 0);
    renderFrame(ctx, p, i, { fallbackBackground: opts.background });
    const data = ctx.getImageData(0, 0, w, h).data;
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, w, h, { palette, delay, repeat: opts.loops > 0 ? 0 : -1 });
    opts.onProgress?.((i + 1) / p.frames.length);
    // UI 가 멈추지 않도록 양보
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}

export async function exportFramePng(p: Project, index: number, scale: number, transparent: boolean): Promise<Blob> {
  const w = Math.max(1, Math.round(p.width * scale));
  const h = Math.max(1, Math.round(p.height * scale));
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderFrame(ctx, p, index, { background: !transparent });
  return canvasToBlob(c);
}
