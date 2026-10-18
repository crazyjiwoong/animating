import type { Project, RefVideo } from '../types';
import { invalidate } from './live';

/*
 * 참고 영상 (따라 그리기용). 프레임마다 영상을 그 시점으로 돌려서 한 장씩 꺼내 쓴다.
 * 꺼낸 장면은 몇십 장까지 기억해 두므로 같은 구간을 다시 볼 때는 바로 나온다.
 */

const CACHE_MAX = 48;
/** 캐시에 넣을 때 최대 가로 크기 (메모리 보호) */
const MAX_W = 1280;

let el: HTMLVideoElement | null = null;
let elBlob: Blob | null = null;
let url = '';
let ready: Promise<void> = Promise.resolve();
const cache = new Map<string, ImageBitmap>();
let last: ImageBitmap | null = null;

function video(blob: Blob) {
  if (el && elBlob === blob) return el;
  if (url) URL.revokeObjectURL(url);
  cache.forEach((b) => b.close());
  cache.clear();
  last = null;
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  url = URL.createObjectURL(blob);
  ready = new Promise<void>((res, rej) => {
    v.addEventListener('loadeddata', () => res(), { once: true });
    v.addEventListener('error', () => rej(new Error('영상을 열 수 없어요')), { once: true });
  });
  ready.catch(() => {});
  v.src = url;
  el = v;
  elBlob = blob;
  return v;
}

/** 영상 파일을 읽어 기본 설정의 참고 영상으로 만든다 */
export async function loadRefVideo(blob: Blob, name: string): Promise<RefVideo> {
  const v = video(blob);
  await ready;
  if (!v.videoWidth) throw new Error('영상을 열 수 없어요');
  return {
    name,
    blob,
    width: v.videoWidth,
    height: v.videoHeight,
    duration: isFinite(v.duration) ? v.duration : 0,
    startFrame: 0,
    trim: 0,
    opacity: 0.5,
    visible: true,
    gray: false,
    fit: 'contain',
    inExport: false,
  };
}

/** 프레임 i 에서 보여 줄 영상 시각 (영상 범위 밖이면 null) */
export function refTime(p: Project, i: number): number | null {
  const r = p.refVideo;
  if (!r) return null;
  const t = (i - r.startFrame) / p.fps + r.trim;
  if (t < 0 || t > r.duration) return null;
  // 끝 바로 앞 장면 (끝 시각 자체는 검은 화면일 수 있음)
  return Math.min(t, Math.max(0, r.duration - 0.001));
}

const keyOf = (t: number) => t.toFixed(3);

function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((res) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return res();
    const done = () => {
      v.removeEventListener('seeked', done);
      res();
    };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

let chain: Promise<unknown> = Promise.resolve();

/** 정확히 그 시각의 장면 (순서대로 처리) */
function grab(blob: Blob, t: number): Promise<ImageBitmap | null> {
  const k = keyOf(t);
  const hit = cache.get(k);
  if (hit && elBlob === blob) return Promise.resolve(hit);
  const job = chain.then(async () => {
    const v = video(blob);
    await ready;
    const again = cache.get(k);
    if (again) return again;
    await seek(v, t);
    const sc = Math.min(1, MAX_W / v.videoWidth);
    const bmp = await createImageBitmap(
      v,
      sc < 1 ? { resizeWidth: Math.round(v.videoWidth * sc), resizeHeight: Math.round(v.videoHeight * sc), resizeQuality: 'medium' } : undefined,
    );
    if (elBlob !== blob) return null;
    cache.set(k, bmp);
    if (cache.size > CACHE_MAX) {
      const [oldK, old] = cache.entries().next().value!;
      cache.delete(oldK);
      if (old !== last) old.close();
    }
    return bmp;
  });
  chain = job.catch(() => null);
  return job.catch(() => null);
}

/* ---- 화면용: 없으면 불러오기를 걸어 두고 직전 장면을 보여 준다 */

let wanted: { blob: Blob; t: number } | null = null;
let pumping = false;

async function pump() {
  if (pumping) return;
  pumping = true;
  while (wanted) {
    const w = wanted;
    wanted = null;
    await grab(w.blob, w.t);
    invalidate();
  }
  pumping = false;
}

function currentFrame(p: Project, i: number): ImageBitmap | null {
  const r = p.refVideo!;
  const t = refTime(p, i);
  if (t === null) return null;
  video(r.blob);
  const hit = cache.get(keyOf(t));
  if (hit) {
    last = hit;
    // 재생 중 끊기지 않도록 다음 몇 장을 미리
    for (let k = 1; k <= 3; k++) {
      const n = refTime(p, i + k);
      if (n !== null && !cache.has(keyOf(n)) && !wanted) wanted = { blob: r.blob, t: n };
    }
    if (wanted) void pump();
    return hit;
  }
  wanted = { blob: r.blob, t };
  void pump();
  return last;
}

/** 영상 장면을 캔버스(프로젝트 좌표)에 맞춰 그린다 */
export function drawRefImage(ctx: CanvasRenderingContext2D, p: Project, img: CanvasImageSource & { width: number; height: number }) {
  const r = p.refVideo!;
  const s = r.fit === 'cover' ? Math.max(p.width / img.width, p.height / img.height) : Math.min(p.width / img.width, p.height / img.height);
  const w = img.width * s,
    h = img.height * s;
  ctx.save();
  ctx.globalAlpha *= r.opacity;
  if (r.gray) ctx.filter = 'grayscale(1)';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.beginPath();
  ctx.rect(0, 0, p.width, p.height);
  ctx.clip();
  ctx.drawImage(img, (p.width - w) / 2, (p.height - h) / 2, w, h);
  ctx.restore();
}

/** 편집 화면용 (비동기로 불러오면서 다시 그리기 요청) */
export function drawRefVideo(ctx: CanvasRenderingContext2D, p: Project, i: number) {
  const r = p.refVideo;
  if (!r || !r.visible) return;
  const img = currentFrame(p, i);
  if (img) drawRefImage(ctx, p, img);
}

/** 내보내기용: 그 프레임의 장면을 기다렸다가 그리는 함수 (포함 안 하면 undefined) */
export async function refUnder(p: Project, i: number): Promise<((ctx: CanvasRenderingContext2D) => void) | undefined> {
  const r = p.refVideo;
  if (!r || !r.visible || !r.inExport) return undefined;
  const t = refTime(p, i);
  if (t === null) return undefined;
  const img = await grab(r.blob, t);
  return img ? (ctx) => drawRefImage(ctx, p, img) : undefined;
}

export function isVideoFile(f: File) {
  if (f.type.startsWith('video/')) return true;
  if (f.type.startsWith('audio/')) return false;
  return /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name);
}
