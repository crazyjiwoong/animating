import type { Transform } from '../types';
import { useEditor } from '../store/editor';
import { alphaBounds, cloneCanvas, createCanvas, ctx2d } from './canvas';
import { DEFAULT_T, drawSourceWithTransform } from './render';
import { invalidate, live } from './live';

export interface Pt {
  x: number;
  y: number;
}

/**
 * 이동 도구에서 꾹 눌러 지정한 범위. 고른 부분(piece)을 원래 그림(hole = 구멍 난 그림) 위에 띄워 놓고
 * 확정할 때 한 장으로 합친다.
 */
export interface Floating {
  layerId: string;
  frameIndex: number;
  /** 범위를 만든 원래 그림 — 그사이 그림이 바뀌면(실행 취소 등) 확정하지 않고 취소한다 */
  from: HTMLCanvasElement;
  hole: HTMLCanvasElement;
  piece: HTMLCanvasElement;
  /** 처음 고른 모양의 테두리 (캔버스 좌표) */
  outline: Pt[];
  /** piece 의 원래 중심 */
  c0: Pt;
  t: Transform;
}

export const sel: { floating: Floating | null } = { floating: null };

function show(f: Floating | null) {
  sel.floating = f;
  live.override = f
    ? {
        layerId: f.layerId,
        draw: (ctx) => {
          ctx.drawImage(f.hole, 0, 0);
          drawSourceWithTransform(ctx, f.piece, f.t);
        },
      }
    : null;
  if (useEditor.getState().selectionActive !== !!f) useEditor.setState({ selectionActive: !!f });
  invalidate();
}

/** 고른 모양을 다각형 점들로 */
export function shapeOutline(kind: 'lasso' | 'rect' | 'ellipse', pts: Pt[]): Pt[] {
  if (kind === 'lasso') return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const x0 = Math.min(a.x, b.x),
    x1 = Math.max(a.x, b.x),
    y0 = Math.min(a.y, b.y),
    y1 = Math.max(a.y, b.y);
  if (kind === 'rect')
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    rx = (x1 - x0) / 2,
    ry = (y1 - y0) / 2;
  return Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    return { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry };
  });
}

/** 범위를 만든다. 고른 곳에 그림이 없으면 null */
export function makeSelection(layerId: string, frameIndex: number, outline: Pt[]): Floating | null {
  const s = useEditor.getState();
  const p = s.project!;
  const cel = p.frames[frameIndex]?.cels[layerId];
  if (!cel || cel.kind !== 'raster' || outline.length < 3) return null;
  const mask = createCanvas(p.width, p.height);
  const m = ctx2d(mask);
  m.beginPath();
  outline.forEach((q, i) => (i ? m.lineTo(q.x, q.y) : m.moveTo(q.x, q.y)));
  m.closePath();
  m.fillStyle = '#000';
  m.fill();
  // 고른 부분만 남긴 그림
  const picked = cloneCanvas(cel.canvas);
  const pc = ctx2d(picked);
  pc.globalCompositeOperation = 'destination-in';
  pc.drawImage(mask, 0, 0);
  const b = alphaBounds(picked);
  if (!b) return null;
  const piece = createCanvas(b.w, b.h);
  ctx2d(piece).drawImage(picked, -b.x, -b.y);
  // 원래 그림에서 고른 부분을 뺀 것
  const hole = cloneCanvas(cel.canvas);
  const hc = ctx2d(hole);
  hc.globalCompositeOperation = 'destination-out';
  hc.drawImage(mask, 0, 0);
  const c0 = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const f: Floating = { layerId, frameIndex, from: cel.canvas, hole, piece, outline, c0, t: { ...DEFAULT_T, x: c0.x, y: c0.y } };
  show(f);
  return f;
}

export function updateSelection(t: Transform) {
  const f = sel.floating;
  if (!f) return;
  f.t = t;
  invalidate();
}

function moved(f: Floating) {
  return f.t.x !== f.c0.x || f.t.y !== f.c0.y || f.t.scale !== 1 || f.t.rotation !== 0 || f.t.flipX || f.t.flipY;
}

/** 떠 있는 그림을 내려놓는다 (움직였을 때만 실행 취소 기록) */
export function commitSelection() {
  const f = sel.floating;
  if (!f) return;
  show(null);
  if (!moved(f)) return;
  const now = useEditor.getState().project?.frames[f.frameIndex]?.cels[f.layerId];
  if (!now || now.kind !== 'raster' || now.canvas !== f.from) return;
  const out = cloneCanvas(f.hole);
  drawSourceWithTransform(ctx2d(out), f.piece, f.t);
  useEditor.getState().setCel(f.frameIndex, f.layerId, { kind: 'raster', canvas: out }, '범위 이동');
}

/** 지정 취소 — 그림은 원래대로 */
export function cancelSelection() {
  if (sel.floating) show(null);
}

/** 고른 부분 지우기 */
export function deleteSelection() {
  const f = sel.floating;
  if (!f) return;
  show(null);
  useEditor.getState().setCel(f.frameIndex, f.layerId, { kind: 'raster', canvas: f.hole }, '범위 지우기');
}

export function nudgeSelection(dx: number, dy: number) {
  const f = sel.floating;
  if (!f) return false;
  updateSelection({ ...f.t, x: f.t.x + dx, y: f.t.y + dy });
  return true;
}

/** 테두리를 현재 변형에 맞게 옮긴 점들 */
export function outlineNow(f: Floating): Pt[] {
  const r = (f.t.rotation * Math.PI) / 180;
  const cos = Math.cos(r),
    sin = Math.sin(r);
  const sx = f.t.scale * (f.t.flipX ? -1 : 1),
    sy = f.t.scale * (f.t.flipY ? -1 : 1);
  return f.outline.map((q) => {
    const x = (q.x - f.c0.x) * sx,
      y = (q.y - f.c0.y) * sy;
    return { x: f.t.x + x * cos - y * sin, y: f.t.y + x * sin + y * cos };
  });
}

// 다른 프레임·레이어·도구로 바꾸면 자동으로 내려놓는다
useEditor.subscribe((s, prev) => {
  if (!sel.floating) return;
  if (s.frameIndex !== prev.frameIndex || s.layerId !== prev.layerId || s.tool !== prev.tool || s.playing) {
    commitSelection();
    return;
  }
  if (s.project !== prev.project) {
    // 고른 그림 자체가 바뀌었으면(실행 취소 등) 취소, 아니면 그대로 띄워 둔다
    const f = sel.floating;
    const now = s.project?.frames[f.frameIndex]?.cels[f.layerId];
    if (!now || now.kind !== 'raster' || now.canvas !== f.from) cancelSelection();
  }
});
