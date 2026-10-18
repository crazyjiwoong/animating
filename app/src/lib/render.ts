import type { Cel, Frame, Layer, Project, Transform } from '../types';
import { createCanvas, ctx2d } from './canvas';
import { applyBoil, boilVariant, applyCamera, applyMotion, cameraActive } from './motion';
import { filterString, isDefaultFx } from './fx';

export const DEFAULT_T: Transform = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false, flipY: false, opacity: 1 };

export interface LayerOverride {
  layerId: string;
  /** 해당 레이어 내용을 직접 그린다 (레이어 투명도/합성모드는 바깥에서 적용) */
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export interface RenderOptions {
  background?: boolean;
  /** 투명 배경일 때 채울 색 (영상 추출 등) */
  fallbackBackground?: string;
  override?: LayerOverride | null;
  /** 레이어 표시 여부 무시하고 특정 레이어만 */
  onlyLayerId?: string;
  /** 레이어 기본 애니메이션(떨림·둥실 등) 적용 — 재생·내보내기 때 */
  motion?: boolean;
  /** 카메라(이동·확대·회전·흔들림) 적용 — 재생 미리보기·내보내기 때 */
  camera?: boolean;
  /** 배경 위·레이어 아래에 그릴 것 (참고 영상) */
  under?: ((ctx: CanvasRenderingContext2D) => void) | null;
}

export function applyTransform(ctx: CanvasRenderingContext2D, t: Transform) {
  ctx.translate(t.x, t.y);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale * (t.flipX ? -1 : 1), t.scale * (t.flipY ? -1 : 1));
}

export function drawSourceWithTransform(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource & { width: number; height: number },
  t: Transform,
) {
  ctx.save();
  applyTransform(ctx, t);
  ctx.globalAlpha *= t.opacity;
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  ctx.restore();
}

export function drawCel(ctx: CanvasRenderingContext2D, project: Project, cel: Cel) {
  if (cel.kind === 'raster') {
    ctx.drawImage(cel.canvas, 0, 0);
  } else {
    const asset = project.assets[cel.assetId];
    if (!asset) return;
    drawSourceWithTransform(ctx, asset.bitmap, cel.t);
  }
}

/** 레이어 내용만 그린다 (투명도·합성 모드 없이). 그릴 게 없으면 false */
function drawLayerContent(
  ctx: CanvasRenderingContext2D,
  project: Project,
  layer: Layer,
  frame: Frame,
  override?: LayerOverride | null,
  motionFrame?: number,
) {
  const cel = frame.cels[layer.id];
  const ov = override && override.layerId === layer.id ? override : null;
  if (!cel && !ov) return false;
  ctx.save();
  if (motionFrame !== undefined && cel) applyMotion(ctx, project, layer, cel, motionFrame);
  if (ov) ov.draw(ctx);
  else if (cel) drawCel(ctx, project, cel);
  ctx.restore();
  return true;
}

export function drawLayer(
  ctx: CanvasRenderingContext2D,
  project: Project,
  layer: Layer,
  frame: Frame,
  override?: LayerOverride | null,
  motionFrame?: number,
) {
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blend;
  drawLayerContent(ctx, project, layer, frame, override, motionFrame);
  ctx.restore();
}

/* ---------------------------------------------------------------- 효과 · 클리핑용 임시 캔버스 */

const pool: HTMLCanvasElement[] = [];
/** 출력 캔버스와 같은 크기·같은 좌표계의 임시 캔버스 (slot 마다 재사용) */
function temp(slot: number, like: CanvasRenderingContext2D) {
  const w = like.canvas.width,
    h = like.canvas.height;
  let c = pool[slot];
  if (!c) c = pool[slot] = createCanvas(w, h);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const t = ctx2d(c);
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalAlpha = 1;
  t.globalCompositeOperation = 'source-over';
  t.filter = 'none';
  t.clearRect(0, 0, w, h);
  t.setTransform(like.getTransform());
  t.imageSmoothingQuality = 'high';
  return t;
}

/** 선 꿈틀 결과 캐시: 그림(셀)마다 모양 3가지만 있으니 한 번 만든 건 다시 쓴다 */
const boilCache = new Map<object, { sig: string; byVariant: Map<number, HTMLCanvasElement> }>();
const BOIL_CACHE_MAX = 24; // 그림 수 (메모리 보호)

function boiled(raw: CanvasRenderingContext2D, project: Project, layer: Layer, frame: Frame, override: LayerOverride | null | undefined, motionFrame: number, scale: number) {
  const m = layer.motion!;
  const variant = boilVariant(m, motionFrame, project.fps);
  const cel = frame.cels[layer.id];
  const live = override && override.layerId === layer.id;
  if (!cel || live) return applyBoil(raw.canvas, m, layer.id, variant, scale);
  const t = raw.getTransform();
  const sig = [raw.canvas.width, raw.canvas.height, t.a, t.b, t.c, t.d, t.e, t.f, m.amount, m.speed, layer.id].join(',');
  let entry = boilCache.get(cel);
  if (entry) boilCache.delete(cel); // 최근 것으로 옮기기
  if (!entry || entry.sig !== sig) entry = { sig, byVariant: new Map() };
  boilCache.set(cel, entry);
  if (boilCache.size > BOIL_CACHE_MAX) boilCache.delete(boilCache.keys().next().value!);
  const hit = entry.byVariant.get(variant);
  if (hit) {
    raw.save();
    raw.setTransform(1, 0, 0, 1, 0, 0);
    raw.clearRect(0, 0, raw.canvas.width, raw.canvas.height);
    raw.drawImage(hit, 0, 0);
    raw.restore();
    return;
  }
  applyBoil(raw.canvas, m, layer.id, variant, scale);
  const keep = createCanvas(raw.canvas.width, raw.canvas.height);
  ctx2d(keep).drawImage(raw.canvas, 0, 0);
  entry.byVariant.set(variant, keep);
}

/** 효과 없이 바로 그려도 되는 레이어인가 */
function plain(layer: Layer, motionFrame: number | undefined) {
  return isDefaultFx(layer.fx) && (motionFrame === undefined || layer.motion?.kind !== 'boil');
}

/** 효과까지 적용한 레이어 내용을 out 에 그린다 (out 은 비어 있어야 함) */
function drawWithFx(out: CanvasRenderingContext2D, project: Project, layer: Layer, frame: Frame, override: LayerOverride | null | undefined, motionFrame: number | undefined, slot: number) {
  if (plain(layer, motionFrame)) return drawLayerContent(out, project, layer, frame, override, motionFrame);
  const fx = isDefaultFx(layer.fx) ? null : layer.fx!;
  const raw = temp(slot, out);
  if (!drawLayerContent(raw, project, layer, frame, override, motionFrame)) return false;
  const m = out.getTransform();
  const scale = Math.hypot(m.a, m.b) || 1;
  // 선 꿈틀 (재생·내보내기 때만)
  if (motionFrame !== undefined && layer.motion?.kind === 'boil') boiled(raw, project, layer, frame, override, motionFrame, scale);
  if (fx?.tint) {
    // 색 입히기: 그림이 있는 곳에만 색을 덮는다
    raw.save();
    raw.setTransform(1, 0, 0, 1, 0, 0);
    raw.globalCompositeOperation = 'source-atop';
    raw.globalAlpha = fx.tint / 100;
    raw.fillStyle = fx.tintColor;
    raw.fillRect(0, 0, raw.canvas.width, raw.canvas.height);
    raw.restore();
  }
  out.save();
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.filter = fx ? filterString(fx, scale) : 'none';
  out.drawImage(raw.canvas, 0, 0);
  out.restore();
  return true;
}

/** ctx 는 프로젝트 좌표계(0..width, 0..height)로 맞춰져 있어야 한다 */
export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, frameIndex: number, opts: RenderOptions = {}) {
  const frame = project.frames[frameIndex];
  if (opts.background !== false) {
    const bg = project.background ?? opts.fallbackBackground;
    if (bg) {
      ctx.save();
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, project.width, project.height);
      ctx.restore();
    }
  }
  if (!frame) return;
  const cam = opts.camera && cameraActive(project);
  if (cam) {
    ctx.save();
    applyCamera(ctx, project, frameIndex);
  }
  opts.under?.(ctx);
  const mf = opts.motion ? frameIndex : undefined;
  const layers = project.layers;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (opts.onlyLayerId) {
      if (layer.id === opts.onlyLayerId) drawLayer(ctx, project, layer, frame, opts.override, mf);
      continue;
    }
    // 이 레이어 위에 붙은 클리핑 레이어들
    let j = i + 1;
    while (j < layers.length && layers[j].clip) j++;
    const clips = layers.slice(i + 1, j).filter((l) => l.visible);
    const base = layer.clip && i > 0 ? null : layer; // 맨 아래 클리핑은 일반 레이어처럼
    if (!base) {
      if (layer.visible) drawLayer(ctx, project, layer, frame, opts.override, mf);
      continue;
    }
    i = j - 1;
    if (!base.visible) continue;
    if (!clips.length && plain(base, mf)) {
      drawLayer(ctx, project, base, frame, opts.override, mf);
      continue;
    }
    // 바탕 레이어(효과 포함) → 그룹 캔버스에 클리핑 레이어를 바탕 모양대로 얹기
    const B = temp(1, ctx);
    if (!drawWithFx(B, project, base, frame, opts.override, mf, 0)) continue;
    // 클리핑은 효과(빛·그림자·흐림) 전 원래 모양을 따른다
    let mask = B.canvas;
    if (clips.length && !isDefaultFx(base.fx)) {
      const M = temp(4, ctx);
      drawWithFx(M, project, { ...base, fx: undefined }, frame, opts.override, mf, 5);
      mask = M.canvas;
    }
    const G = temp(2, ctx);
    G.save();
    G.setTransform(1, 0, 0, 1, 0, 0);
    G.drawImage(B.canvas, 0, 0);
    for (const c of clips) {
      const T = temp(3, ctx);
      if (!drawWithFx(T, project, c, frame, opts.override, mf, 0)) continue;
      T.save();
      T.setTransform(1, 0, 0, 1, 0, 0);
      T.globalCompositeOperation = 'destination-in';
      T.drawImage(mask, 0, 0);
      T.restore();
      G.globalAlpha = c.opacity;
      G.globalCompositeOperation = c.blend;
      G.drawImage(T.canvas, 0, 0);
    }
    G.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = base.opacity;
    ctx.globalCompositeOperation = base.blend;
    ctx.drawImage(G.canvas, 0, 0);
    ctx.restore();
  }
  if (cam) ctx.restore();
}

export function renderFrameCanvas(project: Project, frameIndex: number, opts: RenderOptions = {}, target?: HTMLCanvasElement) {
  const c = target ?? createCanvas(project.width, project.height);
  if (c.width !== project.width || c.height !== project.height) {
    c.width = project.width;
    c.height = project.height;
  }
  const ctx = ctx2d(c);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  renderFrame(ctx, project, frameIndex, opts);
  return c;
}

/** 축소된 썸네일 */
export function renderThumb(project: Project, frameIndex: number, maxW: number, maxH: number, target?: HTMLCanvasElement) {
  const s = Math.min(maxW / project.width, maxH / project.height);
  const w = Math.max(1, Math.round(project.width * s));
  const h = Math.max(1, Math.round(project.height * s));
  const c = target ?? createCanvas(w, h);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = ctx2d(c);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = project.background ?? '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  renderFrame(ctx, project, frameIndex, { background: false });
  return c;
}

/** 어니언 스킨용: 프레임을 단색으로 물들인 캔버스 */
export function renderTinted(project: Project, frameIndex: number, tint: string, target?: HTMLCanvasElement) {
  const c = renderFrameCanvas(project, frameIndex, { background: false }, target);
  const ctx = ctx2d(c);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.restore();
  return c;
}
