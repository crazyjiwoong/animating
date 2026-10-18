import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Project } from '../types';
import { createCanvas, ctx2d, canvasToBlob } from './canvas';
import { renderFrame } from './render';
import { audioCtx, audioTimeAtFrame } from './audio';
import { desktop } from './platform';

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
    renderFrame(ctx, p, i % p.frames.length, { fallbackBackground: opts.background, motion: true, camera: true });
  };
  draw(0);

  // requestFrame 이 없는 브라우저는 일정 속도로 캡처한다
  const manual = typeof CanvasCaptureMediaStreamTrack !== 'undefined' && 'requestFrame' in CanvasCaptureMediaStreamTrack.prototype;
  const stream = canvas.captureStream(manual ? 0 : p.fps);
  const vtrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const pushFrame = () => manual && vtrack.requestFrame();
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
  pushFrame();
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
        pushFrame();
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
    renderFrame(ctx, p, i, { fallbackBackground: opts.background, motion: true, camera: true });
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
  renderFrame(ctx, p, index, { background: !transparent, motion: true, camera: true });
  return canvasToBlob(c);
}

/** 모든 프레임을 한 장에 격자로 배치한 스프라이트 시트 */
export async function exportSpriteSheet(p: Project, scale: number, transparent: boolean): Promise<Blob> {
  const fw = Math.max(1, Math.round(p.width * scale));
  const fh = Math.max(1, Math.round(p.height * scale));
  const n = p.frames.length;
  // 가로세로가 비슷하도록, 너무 크면 열 수를 줄이지 않고 그대로 (브라우저 최대 약 16k)
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * fh) / fw))));
  const rows = Math.ceil(n / cols);
  if (cols * fw > 16384 || rows * fh > 16384) throw new Error('시트가 너무 커요 · 해상도를 낮춰 주세요');
  const c = createCanvas(cols * fw, rows * fh);
  const ctx = ctx2d(c);
  for (let i = 0; i < n; i++) {
    ctx.setTransform(scale, 0, 0, scale, (i % cols) * fw, Math.floor(i / cols) * fh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, p.width, p.height);
    ctx.clip();
    renderFrame(ctx, p, i, { background: !transparent, motion: true, camera: true });
    ctx.restore();
  }
  return canvasToBlob(c);
}

/** 프레임별 PNG 를 zip 으로 */
export async function exportPngSequence(p: Project, scale: number, transparent: boolean, baseName: string, onProgress?: (r: number) => void): Promise<Blob> {
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < p.frames.length; i++) {
    const blob = await exportFramePng(p, i, scale, transparent);
    files[`${baseName}_${String(i + 1).padStart(4, '0')}.png`] = new Uint8Array(await blob.arrayBuffer());
    onProgress?.((i + 1) / p.frames.length);
  }
  // PNG 는 이미 압축돼 있으므로 저장만
  return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
}

/**
 * PC 앱 전용: 프레임을 한 장씩 ffmpeg 로 보내 H.264 MP4 / VP9 WebM 을 만든다.
 * 실시간 녹화가 아니라서 프레임이 정확하고 보통 재생 시간보다 빠르다.
 */
export async function exportVideoNative(
  p: Project,
  format: 'mp4' | 'webm',
  path: string,
  opts: ExportOptions & { quality?: number },
): Promise<void> {
  if (!desktop) throw new Error('PC 앱에서만 쓸 수 있어요');
  const w = even(p.width * opts.scale);
  const h = even(p.height * opts.scale);
  const canvas = createCanvas(w, h);
  const ctx = ctx2d(canvas, { willReadFrequently: true });
  const n = p.frames.length;
  const total = n * Math.max(1, opts.loops);
  const a = opts.withAudio && p.audio && !p.audio.muted ? p.audio : null;
  const id = await desktop.video.start({
    path,
    format,
    width: w,
    height: h,
    fps: p.fps,
    frames: total,
    loopFrames: n,
    quality: opts.quality,
    audio: a ? { name: a.name, data: await a.blob.arrayBuffer(), trim: a.trim, delay: a.startFrame / p.fps, volume: a.volume } : undefined,
  });
  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException('취소됨', 'AbortError');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(w / p.width, 0, 0, h / p.height, 0, 0);
      ctx.imageSmoothingQuality = 'high';
      renderFrame(ctx, p, i % n, { fallbackBackground: opts.background, motion: true, camera: true });
      await desktop.video.frame(id, ctx.getImageData(0, 0, w, h).data.buffer);
      opts.onProgress?.((i + 1) / (total + 1));
    }
  } catch (e) {
    await desktop.video.cancel(id);
    throw e;
  }
  const r = await desktop.video.finish(id);
  if (!r.ok) throw new Error(r.error ?? '동영상을 만들지 못했어요');
  opts.onProgress?.(1);
}
