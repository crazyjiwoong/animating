import type { Cel, Frame, Layer, Project, Transform } from '../types';
import { createCanvas, ctx2d } from './canvas';
import { applyCamera, applyMotion, cameraActive } from './motion';

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

export function drawLayer(
  ctx: CanvasRenderingContext2D,
  project: Project,
  layer: Layer,
  frame: Frame,
  override?: LayerOverride | null,
  motionFrame?: number,
) {
  const cel = frame.cels[layer.id];
  const ov = override && override.layerId === layer.id ? override : null;
  if (!cel && !ov) return;
  ctx.save();
  if (motionFrame !== undefined && cel) applyMotion(ctx, project, layer, cel, motionFrame);
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blend;
  if (ov) ov.draw(ctx);
  else if (cel) drawCel(ctx, project, cel);
  ctx.restore();
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
  for (const layer of project.layers) {
    if (opts.onlyLayerId) {
      if (layer.id !== opts.onlyLayerId) continue;
    } else if (!layer.visible) continue;
    drawLayer(ctx, project, layer, frame, opts.override, opts.motion ? frameIndex : undefined);
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
