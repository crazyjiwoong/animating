import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, Lock, EyeOff, Grid3x3, Scan, FlipHorizontal2, RotateCcw, RotateCw } from 'lucide-react';
import type { Frame, Layer, Project, Transform } from '../types';
import { useEditor, currentLayer, type ShapeKind, type SelShape } from '../store/editor';
import { cameraAt } from '../lib/motion';
import { sel, makeSelection, shapeOutline, updateSelection, commitSelection, outlineNow, type Pt } from '../lib/selection';
import { useView, viewMatrix, toScreenPt, toCanvasPt, panFor } from '../store/view';
import { live, invalidate, onInvalidate } from '../lib/live';
import { alphaBounds, checkerPattern, cloneCanvas, createCanvas, ctx2d, floodFillMask, rgbToHex, type Rect } from '../lib/canvas';
import { DEFAULT_T, drawSourceWithTransform, renderFrameCanvas, renderTinted } from '../lib/render';
import { drawRefVideo } from '../lib/refvideo';
import { importFiles } from '../lib/importers';

/* ---------------------------------------------------------------- 캐시 */

const boundsCache = new WeakMap<HTMLCanvasElement, Rect | null>();
function rasterBounds(c: HTMLCanvasElement) {
  if (!boundsCache.has(c)) boundsCache.set(c, alphaBounds(c));
  return boundsCache.get(c)!;
}

/** 프레임의 '그림 구성' — 보이는 레이어들의 셀 key 묶음 */
function frameSig(p: Project, i: number) {
  const f = p.frames[i];
  return p.layers.map((l) => (l.visible ? (f.cels[l.id]?.key ?? (f.cels[l.id] ? `#${i}` : '-')) : '')).join('|');
}

/** 어니언 스킨으로 보여줄 프레임들 (가까운 순) */
function onionFrames(p: Project, cur: number, dir: -1 | 1, count: number, loop: boolean, skipSame: boolean) {
  const n = p.frames.length;
  const out: number[] = [];
  let last = skipSame ? frameSig(p, cur) : '';
  let i = cur;
  for (let step = 0; step < n && out.length < count; step++) {
    i += dir;
    if (i < 0 || i >= n) {
      if (!loop || n <= 2) break;
      i = (i + n) % n;
    }
    if (i === cur) break;
    if (skipSame) {
      const sg = frameSig(p, i);
      if (sg === last) continue;
      last = sg;
    }
    out.push(i);
  }
  return out;
}

const onionCache = new Map<string, { frame: Frame; layers: Layer[]; canvas: HTMLCanvasElement }>();
/** 현재 프레임과 그림이 다른 레이어만 모아 그린다 (같은 배경 등은 제외) */
function onionCanvas(p: Project, i: number, cur: number, tint: string | null) {
  const f = p.frames[i];
  const c = p.frames[cur];
  const layers = p.layers.filter((l) => l.visible && f.cels[l.id] && f.cels[l.id] !== c.cels[l.id] && (!f.cels[l.id]!.key || f.cels[l.id]!.key !== c.cels[l.id]?.key));
  const sig = layers.map((l) => l.id).join(',');
  const key = `${f.id}|${tint}|${sig}`;
  const hit = onionCache.get(key);
  if (hit && hit.frame === f && hit.layers === p.layers && hit.canvas.width === p.width && hit.canvas.height === p.height) return hit.canvas;
  const sub = { ...p, layers: layers.map((l) => ({ ...l, opacity: l.opacity })) };
  const canvas = tint ? renderTinted(sub, i, tint, hit?.canvas) : renderFrameCanvas(sub, i, { background: false }, hit?.canvas);
  onionCache.set(key, { frame: f, layers: p.layers, canvas });
  if (onionCache.size > 40) onionCache.delete(onionCache.keys().next().value!);
  return canvas;
}

/** 캔버스 좌표 → 화면 좌표 (확대·회전·좌우 반전 반영) */
const toScreen = toScreenPt;

/** 카메라가 보는 영역 (캔버스 좌표의 상자) */
function cameraBox(p: Project, i: number): Box {
  const c = cameraAt(p, i);
  return { w: p.width, h: p.height, t: { ...DEFAULT_T, x: c.x, y: c.y, scale: 1 / c.zoom, rotation: c.rotation } };
}

function drawShape(ctx: CanvasRenderingContext2D, kind: ShapeKind, a: { x: number; y: number }, b: { x: number; y: number }, fill: boolean, color: string, size: number) {
  ctx.lineWidth = size;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'line') {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return;
  }
  if (kind === 'rect') ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  else ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
  if (fill) ctx.fill();
  else ctx.stroke();
}

/* ---------------------------------------------------------------- 변형 대상 */

interface Box {
  w: number;
  h: number;
  t: Transform;
}

function targetBox(p: Project, frameIndex: number, layerId: string): Box | null {
  const cel = p.frames[frameIndex]?.cels[layerId];
  if (!cel) return null;
  if (cel.kind === 'image') {
    const a = p.assets[cel.assetId];
    return a ? { w: a.width, h: a.height, t: cel.t } : null;
  }
  const b = rasterBounds(cel.canvas);
  if (!b) return null;
  return { w: b.w, h: b.h, t: { ...DEFAULT_T, x: b.x + b.w / 2, y: b.y + b.h / 2 } };
}

function boxCorners(b: Box): [number, number][] {
  const r = (b.t.rotation * Math.PI) / 180;
  const cos = Math.cos(r),
    sin = Math.sin(r);
  const hw = (b.w * b.t.scale) / 2,
    hh = (b.h * b.t.scale) / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [b.t.x + x * cos - y * sin, b.t.y + x * sin + y * cos]);
}

function insideBox(b: Box, x: number, y: number) {
  const r = (-b.t.rotation * Math.PI) / 180;
  const dx = x - b.t.x,
    dy = y - b.t.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= (b.w * b.t.scale) / 2 && Math.abs(ly) <= (b.h * b.t.scale) / 2;
}

/* ---------------------------------------------------------------- 드래그 상태 */

type Drag =
  | { type: 'pan'; sx: number; sy: number; px: number; py: number }
  | { type: 'rotateView'; a0: number; r0: number }
  | {
      type: 'stroke';
      layerId: string;
      frameIndex: number;
      base: HTMLCanvasElement | null;
      stroke: HTMLCanvasElement;
      work: HTMLCanvasElement;
      erase: boolean;
      alphaLock: boolean;
      size: number;
      opacity: number;
      smoothing: number;
      pressure: boolean;
      color: string;
      last: { x: number; y: number; s: number };
      smooth: { x: number; y: number };
    }
  | {
      type: 'transform';
      mode: 'move' | 'scale' | 'rotate';
      layerId: string;
      frameIndex: number;
      kind: 'image' | 'raster' | 'selection' | 'camera';
      src: CanvasImageSource & { width: number; height: number };
      t0: Transform;
      t: Transform;
      w: number;
      h: number;
      start: { x: number; y: number };
      startAngle: number;
      startDist: number;
    }
  | {
      type: 'shape';
      layerId: string;
      frameIndex: number;
      base: HTMLCanvasElement | null;
      work: HTMLCanvasElement;
      start: { x: number; y: number };
      end: { x: number; y: number };
      kind: ShapeKind;
      fill: boolean;
      color: string;
      size: number;
      opacity: number;
      alphaLock: boolean;
    }
  | { type: 'pinch'; d0: number; z0: number; a0: number; r0: number; cx: number; cy: number; mx: number; my: number }
  /** 이동 도구: 꾹 누르는지 보는 중 (움직이면 이동, 가만히 있으면 범위 지정) */
  | { type: 'pending'; downPt: { x: number; y: number }; downC: Pt; timer: number }
  /** 이동 도구: 꾹 누른 뒤 범위를 그리는 중 */
  | { type: 'select'; layerId: string; frameIndex: number; shape: SelShape; pts: Pt[] };

const LONG_PRESS_MS = 380;

function stamp(ctx: CanvasRenderingContext2D, ax: number, ay: number, as: number, bx: number, by: number, bs: number) {
  const dist = Math.hypot(bx - ax, by - ay);
  const step = Math.max(0.35, Math.min(as, bs) * 0.12);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const r = Math.max(0.35, (as + (bs - as) * t) / 2);
    ctx.beginPath();
    ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function Viewport() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameBuf = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const hover = useRef<{ x: number; y: number } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [altHeld, setAltHeld] = useState(false);
  const [rHeld, setRHeld] = useState(false);
  const viewRot = useView((s) => s.rotation);
  const [dropping, setDropping] = useState(false);
  const tool = useEditor((s) => s.tool);
  const layer = useEditor(currentLayer);
  const zoom = useView((s) => s.zoom);
  const fitTick = useView((s) => s.fitTick);
  const projectSize = useEditor((s) => (s.project ? `${s.project.width}x${s.project.height}` : ''));
  const keys = useRef({ space: false, alt: false, r: false });

  /* ---------------- 그리기 */
  const raf = useRef(0);
  const schedule = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      draw();
    });
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const s = useEditor.getState();
    const p = s.project;
    if (!canvas || !p) return;
    const v = useView.getState();
    const dpr = window.devicePixelRatio || 1;
    const ctx = ctx2d(canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const showOnion = s.onion.enabled && !s.playing;
    // 현재 프레임 합성
    // 재생 중에는 기본 애니메이션과 카메라까지 적용해서 실제 결과처럼
    frameBuf.current = renderFrameCanvas(
      p,
      s.frameIndex,
      { background: true, override: live.override, motion: s.playing, camera: s.playing && s.cameraView, under: (c) => drawRefVideo(c, p, s.frameIndex) },
      frameBuf.current ?? undefined,
    );

    // 보기 행렬 (확대·이동·회전·좌우 반전)
    const m = new DOMMatrix().scale(dpr, dpr).multiply(viewMatrix(v));
    ctx.setTransform(m);
    // 종이 그림자
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.restore();
    // 배경 (투명이면 체크무늬)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, p.width, p.height);
    ctx.clip();
    if (p.background) {
      ctx.fillStyle = p.background;
      ctx.fillRect(0, 0, p.width, p.height);
    } else {
      ctx.fillStyle = checkerPattern(ctx);
      ctx.fillRect(0, 0, p.width, p.height);
    }
    ctx.imageSmoothingEnabled = v.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frameBuf.current, 0, 0);
    if (showOnion) {
      // 이전/다음 프레임을 현재 그림 위에 반투명하게
      const { before, after, opacity, mode, skipSame } = s.onion;
      const tinted = mode === 'tint';
      const prev = onionFrames(p, s.frameIndex, -1, before, s.loop, skipSame);
      const next = onionFrames(p, s.frameIndex, 1, after, s.loop, skipSame);
      prev.forEach((idx, k) => {
        ctx.globalAlpha = opacity * (1 - k / (before + 1));
        ctx.drawImage(onionCanvas(p, idx, s.frameIndex, tinted ? '#ff4d6d' : null), 0, 0);
      });
      next.forEach((idx, k) => {
        ctx.globalAlpha = opacity * (1 - k / (after + 1));
        ctx.drawImage(onionCanvas(p, idx, s.frameIndex, tinted ? '#3d8bff' : null), 0, 0);
      });
      ctx.globalAlpha = 1;
    }
    // 격자 · 안전 영역
    if (s.grid.enabled || s.grid.safe) {
      ctx.lineWidth = 1 / v.zoom;
      if (s.grid.enabled) {
        const g = Math.max(4, s.grid.size);
        ctx.strokeStyle = 'rgba(139,123,255,0.28)';
        ctx.beginPath();
        for (let x = g; x < p.width; x += g) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, p.height);
        }
        for (let y = g; y < p.height; y += g) {
          ctx.moveTo(0, y);
          ctx.lineTo(p.width, y);
        }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,111,181,0.45)';
        ctx.beginPath();
        ctx.moveTo(p.width / 2, 0);
        ctx.lineTo(p.width / 2, p.height);
        ctx.moveTo(0, p.height / 2);
        ctx.lineTo(p.width, p.height / 2);
        ctx.stroke();
      }
      if (s.grid.safe) {
        ctx.setLineDash([8 / v.zoom, 6 / v.zoom]);
        ctx.strokeStyle = 'rgba(255,179,64,0.75)';
        ctx.strokeRect(p.width * 0.05, p.height * 0.05, p.width * 0.9, p.height * 0.9);
        ctx.strokeStyle = 'rgba(94,227,140,0.75)';
        ctx.strokeRect(p.width * 0.1, p.height * 0.1, p.width * 0.8, p.height * 0.8);
        ctx.setLineDash([]);
      }
    }
    ctx.restore();

    // 테두리
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1 / v.zoom;
    ctx.strokeRect(0, 0, p.width, p.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 변형 상자
    const d = drag.current;
    /** 변형 상자: 테두리 · 모서리 손잡이 · 회전 손잡이 */
    const drawHandles = (pts: number[][], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
      const [tl, tr] = pts;
      const rot = rotHandle(pts);
      ctx.beginPath();
      ctx.moveTo((tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2);
      ctx.lineTo(rot[0], rot[1]);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      for (const [x, y] of pts) {
        ctx.beginPath();
        ctx.rect(x - 5, y - 5, 10, 10);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(rot[0], rot[1], 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    // 카메라 틀 (카메라 도구)
    if (s.tool === 'camera' && !s.playing) {
      const box = d?.type === 'transform' && d.kind === 'camera' ? { w: d.w, h: d.h, t: d.t } : cameraBox(p, s.frameIndex);
      const pts = boxCorners(box).map(([x, y]) => toScreen(x, y));
      // 바깥 어둡게
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width / dpr, canvas.height / dpr);
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(8,10,16,0.55)';
      ctx.fill('evenodd');
      ctx.restore();
      drawHandles(pts, '#ffb340');
      const hasKey = !!p.camera?.keys.some((k) => k.frameId === p.frames[s.frameIndex].id);
      ctx.font = '600 12px Pretendard Variable, sans-serif';
      ctx.fillStyle = '#ffb340';
      ctx.fillText(hasKey ? '🎥 카메라 · 이 프레임에 키 있음' : '🎥 카메라 · 끌면 이 프레임에 키가 생겨요', pts[0][0] + 6, pts[0][1] - 8);
    }

    // 개미 줄 (흰 선 + 검은 점선)
    const ants = (pts: Pt[], closed: boolean) => {
      if (pts.length < 2) return;
      const sp = pts.map((q) => toScreen(q.x, q.y));
      const path = () => {
        ctx.beginPath();
        sp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (closed) ctx.closePath();
      };
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.strokeStyle = '#fff';
      path();
      ctx.stroke();
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -((performance.now() / 60) % 9);
      ctx.strokeStyle = '#1d1f2b';
      path();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    };
    if ((s.tool === 'move' || s.tool === 'select') && !s.playing && !keys.current.space) {
      if (d?.type === 'select') {
        ants(shapeOutline(d.shape, d.pts), d.shape !== 'lasso' || d.pts.length > 2);
        // 꾹 누른 자리 표시
        const [px, py] = toScreen(d.pts[0].x, d.pts[0].y);
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#8b7bff';
        ctx.fill();
      }
      const f = sel.floating;
      if (f) ants(outlineNow(f), true);
      let box: Box | null = null;
      if (f) box = { w: f.piece.width, h: f.piece.height, t: f.t };
      else if (d?.type === 'transform') box = { w: d.w, h: d.h, t: d.t };
      else if (d?.type !== 'select' && s.tool === 'move') box = targetBox(p, s.frameIndex, s.layerId);
      if (box) drawHandles(boxCorners(box).map(([x, y]) => toScreen(x, y)), '#8b7bff');
    }

    // 브러시 커서
    const h = hover.current;
    if (h && (s.tool === 'brush' || s.tool === 'eraser') && !keys.current.space && !keys.current.alt && !s.playing) {
      const size = (s.tool === 'brush' ? s.brush.size : s.eraser.size) * v.zoom;
      ctx.beginPath();
      ctx.arc(h.x, h.y, Math.max(1.5, size / 2), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  };

  function rotHandle(pts: number[][]): [number, number] {
    const [tl, tr, , bl] = pts;
    const mx = (tl[0] + tr[0]) / 2,
      my = (tl[1] + tr[1]) / 2;
    // 위쪽 방향 = bl → tl
    let ux = tl[0] - bl[0],
      uy = tl[1] - bl[1];
    const len = Math.hypot(ux, uy) || 1;
    ux /= len;
    uy /= len;
    return [mx + ux * 28, my + uy * 28];
  }

  /* ---------------- 크기 / 구독 */
  useEffect(() => {
    const stage = stageRef.current!;
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      const v = useView.getState();
      const first = v.stageW === 0;
      // 크기가 바뀌면 중심 유지
      const dx = (r.width - v.stageW) / 2,
        dy = (r.height - v.stageH) / 2;
      useView.getState().setView({ stageW: r.width, stageH: r.height, ...(first ? {} : { panX: v.panX + dx, panY: v.panY + dy }) });
      if (first) useView.getState().fit();
      draw();
    });
    ro.observe(stage);
    const u1 = useEditor.subscribe(schedule);
    const u2 = useView.subscribe(schedule);
    const u3 = onInvalidate(schedule);
    return () => {
      ro.disconnect();
      u1();
      u2();
      u3();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);

  // 범위가 떠 있는 동안 개미 줄이 움직이게
  const selectionActive = useEditor((s) => s.selectionActive);
  useEffect(() => {
    if (!selectionActive) return;
    const id = setInterval(schedule, 90);
    return () => clearInterval(id);
  }, [selectionActive]);

  // 화면 맞춤
  useEffect(() => {
    const p = useEditor.getState().project;
    const v = useView.getState();
    if (!p || !v.stageW) return;
    // 회전돼 있으면 돌아간 종이 전체가 들어오게
    const r = (v.rotation * Math.PI) / 180;
    const bw = Math.abs(p.width * Math.cos(r)) + Math.abs(p.height * Math.sin(r));
    const bh = Math.abs(p.width * Math.sin(r)) + Math.abs(p.height * Math.cos(r));
    const z = Math.min((v.stageW - 64) / bw, (v.stageH - 64) / bh, 4);
    v.setView({ zoom: z, ...panFor(v.stageW / 2, v.stageH / 2, p.width / 2, p.height / 2, z, v.rotation) });
  }, [fitTick, projectSize]);

  // 스페이스(손 도구) / Alt(스포이드)
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest?.('input,textarea,select');
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === 'Space' && !keys.current.space) {
        keys.current.space = true;
        setSpaceHeld(true);
        e.preventDefault();
        schedule();
      }
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
        keys.current.r = true;
        setRHeld(true);
      }
      if (e.key === 'Alt') {
        keys.current.alt = true;
        setAltHeld(true);
        e.preventDefault();
        schedule();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        keys.current.space = false;
        setSpaceHeld(false);
        schedule();
      }
      if (e.key === 'r' || e.key === 'R') {
        keys.current.r = false;
        setRHeld(false);
      }
      if (e.key === 'Alt') {
        keys.current.alt = false;
        setAltHeld(false);
        schedule();
      }
    };
    const blur = () => {
      keys.current = { space: false, alt: false, r: false };
      setRHeld(false);
      setSpaceHeld(false);
      setAltHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /* ---------------- 좌표 */
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toCanvas = toCanvasPt;

  /* ---------------- 포인터 */
  const cancelDrag = () => {
    const d = drag.current;
    if (d?.type === 'pending') clearTimeout(d.timer);
    drag.current = null;
    // 떠 있는 범위는 그대로 보여 준다
    if (!sel.floating) live.override = null;
    invalidate();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const el = canvasRef.current!;
    el.setPointerCapture(e.pointerId);
    const pt = local(e);
    pointers.current.set(e.pointerId, pt);
    const s = useEditor.getState();
    const p = s.project!;
    const v = useView.getState();

    // 두 손가락 → 핀치
    if (pointers.current.size === 2) {
      cancelDrag();
      const [a, b] = [...pointers.current.values()];
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const c = toCanvas(mx, my);
      drag.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: v.zoom, a0: Math.atan2(b.y - a.y, b.x - a.x), r0: v.rotation, cx: c.x, cy: c.y, mx, my };
      return;
    }
    if (pointers.current.size > 2) return;
    if (s.playing) s.set({ playing: false });

    const tool = keys.current.space || e.button === 1 ? 'hand' : keys.current.alt && (s.tool === 'brush' || s.tool === 'fill') ? 'picker' : s.tool;
    if (keys.current.r) {
      // R 누른 채 드래그 = 화면 회전
      drag.current = { type: 'rotateView', a0: Math.atan2(pt.y - v.stageH / 2, pt.x - v.stageW / 2), r0: v.rotation };
      return;
    }
    if (tool === 'hand') {
      drag.current = { type: 'pan', sx: pt.x, sy: pt.y, px: v.panX, py: v.panY };
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const c = toCanvas(pt.x, pt.y);

    if (tool === 'picker') {
      const comp = renderFrameCanvas(p, s.frameIndex, { fallbackBackground: '#ffffff' });
      const x = Math.floor(c.x),
        y = Math.floor(c.y);
      if (x < 0 || y < 0 || x >= p.width || y >= p.height) return;
      const d = ctx2d(comp, { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
      s.setColor(rgbToHex(d[0], d[1], d[2]));
      return;
    }

    if (tool === 'camera') {
      const box = cameraBox(p, s.frameIndex);
      const mode = hitBox(box, pt, c);
      if (!mode) return;
      drag.current = {
        type: 'transform',
        mode,
        layerId: '',
        frameIndex: s.frameIndex,
        kind: 'camera',
        src: frameBuf.current!,
        t0: { ...box.t },
        t: { ...box.t },
        w: box.w,
        h: box.h,
        start: c,
        startAngle: Math.atan2(c.y - box.t.y, c.x - box.t.x),
        startDist: Math.hypot(c.x - box.t.x, c.y - box.t.y) || 1,
      };
      return;
    }

    const lyr = currentLayer(s);
    if (!lyr) return;
    if (lyr.locked) {
      s.toast('잠긴 레이어예요 · 레이어 패널에서 잠금을 풀어 주세요', 'error');
      return;
    }

    if (tool === 'shape') {
      if (lyr.kind !== 'raster') {
        s.toast('이미지 레이어에는 도형을 그릴 수 없어요 · 새 레이어를 추가하세요', 'error');
        return;
      }
      const cel = p.frames[s.frameIndex].cels[lyr.id];
      drag.current = {
        type: 'shape',
        layerId: lyr.id,
        frameIndex: s.frameIndex,
        base: cel?.kind === 'raster' ? cel.canvas : null,
        work: createCanvas(p.width, p.height),
        start: c,
        end: c,
        kind: s.shape.kind,
        fill: s.shape.fill,
        color: s.color,
        size: s.brush.size,
        opacity: s.brush.opacity,
        alphaLock: lyr.alphaLock,
      };
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      if (lyr.kind !== 'raster') {
        s.toast('이미지 레이어에는 그릴 수 없어요 · 새 레이어를 추가하거나 “래스터화” 하세요', 'error');
        return;
      }
      const cel = p.frames[s.frameIndex].cels[lyr.id];
      const base = cel?.kind === 'raster' ? cel.canvas : null;
      if (tool === 'eraser' && !base) return;
      const st = tool === 'brush' ? s.brush : s.eraser;
      const pressure = e.pointerType === 'pen' && st.pressure ? 0.15 + 0.85 * e.pressure : 1;
      const stroke = createCanvas(p.width, p.height);
      const sctx = ctx2d(stroke);
      sctx.fillStyle = tool === 'brush' ? s.color : '#000';
      const size = st.size * pressure;
      stamp(sctx, c.x, c.y, size, c.x, c.y, size);
      const d: Drag = {
        type: 'stroke',
        layerId: lyr.id,
        frameIndex: s.frameIndex,
        base,
        stroke,
        work: createCanvas(p.width, p.height),
        erase: tool === 'eraser',
        alphaLock: lyr.alphaLock,
        size: st.size,
        opacity: st.opacity,
        smoothing: st.smoothing,
        pressure: st.pressure,
        color: s.color,
        last: { x: c.x, y: c.y, s: size },
        smooth: { x: c.x, y: c.y },
      };
      drag.current = d;
      composeStroke(d);
      return;
    }

    if (tool === 'fill') {
      if (lyr.kind !== 'raster') {
        s.toast('이미지 레이어에는 채우기를 할 수 없어요', 'error');
        return;
      }
      const cel = p.frames[s.frameIndex].cels[lyr.id];
      const base = cel?.kind === 'raster' ? cel.canvas : null;
      const ref = s.fill.allLayers ? renderFrameCanvas(p, s.frameIndex, { background: false }) : base ?? createCanvas(p.width, p.height);
      const mask = floodFillMask(ref, c.x, c.y, s.color, s.fill.tolerance, 1);
      if (!mask) return;
      const out = base ? cloneCanvas(base) : createCanvas(p.width, p.height);
      const octx = ctx2d(out);
      if (lyr.alphaLock) octx.globalCompositeOperation = 'source-atop';
      octx.drawImage(mask, 0, 0);
      s.setCel(s.frameIndex, lyr.id, { kind: 'raster', canvas: out }, '채우기');
      return;
    }

    if (tool === 'move' || tool === 'select') {
      // 떠 있는 범위: 손잡이·안쪽이면 그 범위를 변형, 바깥이면 내려놓기
      const f = sel.floating;
      if (f) {
        const box: Box = { w: f.piece.width, h: f.piece.height, t: f.t };
        const mode = hitBox(box, pt, c);
        if (mode) {
          drag.current = {
            type: 'transform',
            mode,
            layerId: f.layerId,
            frameIndex: f.frameIndex,
            kind: 'selection',
            src: f.piece,
            t0: { ...f.t },
            t: { ...f.t },
            w: box.w,
            h: box.h,
            start: c,
            startAngle: Math.atan2(c.y - f.t.y, c.x - f.t.x),
            startDist: Math.hypot(c.x - f.t.x, c.y - f.t.y) || 1,
          };
          return;
        }
        commitSelection();
      }
      if (tool === 'select') {
        // 올가미 도구: 누르자마자 범위 그리기
        drag.current = { type: 'pending', downPt: pt, downC: c, timer: 0 };
        startSelect();
        return;
      }
      // 꾹 누르면 범위 지정, 바로 움직이면 이동
      const timer = window.setTimeout(startSelect, LONG_PRESS_MS);
      drag.current = { type: 'pending', downPt: pt, downC: c, timer };
      return;
    }
  };

  /** 상자의 어느 부분을 눌렀는지 (화면 좌표 pt, 캔버스 좌표 c) */
  const hitBox = (box: Box, pt: { x: number; y: number }, c: Pt): 'move' | 'scale' | 'rotate' | null => {
    const screenPts = boxCorners(box).map(([x, y]) => toScreen(x, y));
    const rh = rotHandle(screenPts);
    if (Math.hypot(pt.x - rh[0], pt.y - rh[1]) < 12) return 'rotate';
    if (screenPts.some(([x, y]) => Math.hypot(pt.x - x, pt.y - y) < 12)) return 'scale';
    if (insideBox(box, c.x, c.y)) return 'move';
    return null;
  };

  /** 꾹 누르기 성공 → 범위 그리기 시작 */
  const startSelect = () => {
    const d = drag.current;
    if (d?.type !== 'pending') return;
    const s = useEditor.getState();
    const lyr = currentLayer(s);
    const cel = s.project?.frames[s.frameIndex]?.cels[s.layerId];
    if (!lyr || lyr.kind !== 'raster') {
      drag.current = null;
      s.toast('범위 지정은 그림(래스터) 레이어에서 쓸 수 있어요 · 이미지 레이어는 그냥 끌어서 옮기세요', 'error');
      return;
    }
    if (!cel) {
      drag.current = null;
      s.toast('이 프레임의 선택한 레이어에 그림이 없어요', 'error');
      return;
    }
    navigator.vibrate?.(15);
    drag.current = { type: 'select', layerId: lyr.id, frameIndex: s.frameIndex, shape: s.selShape, pts: [d.downC] };
    invalidate();
  };

  /** 레이어 전체 이동·변형 시작 (예전 동작). 시작했으면 true */
  const beginMove = (pt: { x: number; y: number }, c: Pt): boolean => {
    const s = useEditor.getState();
    const p = s.project!;
    const lyr = currentLayer(s);
    if (!lyr) return false;
    let box = targetBox(p, s.frameIndex, lyr.id);
    let layerId = lyr.id;
    let mode = box ? hitBox(box, pt, c) : null;
    if (!mode) {
      // 다른 이미지 레이어 자동 선택
      const frame = p.frames[s.frameIndex];
      for (let i = p.layers.length - 1; i >= 0; i--) {
        const l = p.layers[i];
        if (!l.visible || l.locked || l.id === lyr.id) continue;
        const b = targetBox(p, s.frameIndex, l.id);
        if (b && frame.cels[l.id]?.kind === 'image' && insideBox(b, c.x, c.y)) {
          s.setLayer(l.id);
          box = b;
          layerId = l.id;
          mode = 'move';
          break;
        }
      }
    }
    if (!mode || !box) {
      // 래스터 레이어는 상자 밖을 잡아도 통째로 이동
      if (lyr.kind === 'raster' && box) mode = 'move';
      else return false;
    }
    const cel = p.frames[s.frameIndex].cels[layerId]!;
    let src: CanvasImageSource & { width: number; height: number };
    let kind: 'image' | 'raster';
    if (cel.kind === 'image') {
      src = p.assets[cel.assetId].bitmap;
      kind = 'image';
    } else {
      const b = rasterBounds(cel.canvas)!;
      const crop = createCanvas(b.w, b.h);
      ctx2d(crop).drawImage(cel.canvas, -b.x, -b.y);
      src = crop;
      kind = 'raster';
    }
    drag.current = {
      type: 'transform',
      mode,
      layerId,
      frameIndex: s.frameIndex,
      kind,
      src,
      t0: { ...box.t },
      t: { ...box.t },
      w: box.w,
      h: box.h,
      start: c,
      startAngle: Math.atan2(c.y - box.t.y, c.x - box.t.x),
      startDist: Math.hypot(c.x - box.t.x, c.y - box.t.y) || 1,
    };
    return true;
  };

  const composeStroke = (d: Drag & { type: 'stroke' }) => {
    const ctx = ctx2d(d.work);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, d.work.width, d.work.height);
    if (d.base) ctx.drawImage(d.base, 0, 0);
    ctx.globalAlpha = d.opacity;
    ctx.globalCompositeOperation = d.erase ? 'destination-out' : d.alphaLock ? 'source-atop' : 'source-over';
    ctx.drawImage(d.stroke, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const work = d.work;
    live.override = { layerId: d.layerId, draw: (c) => c.drawImage(work, 0, 0) };
    invalidate();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pt = local(e);
    hover.current = pt;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pt);
    const d = drag.current;
    const s = useEditor.getState();
    if (!d) {
      if (s.tool === 'brush' || s.tool === 'eraser') schedule();
      return;
    }
    const v = useView.getState();
    if (d.type === 'pending') {
      // 꾹 누르기 전에 움직였다 → 보통 이동
      if (Math.hypot(pt.x - d.downPt.x, pt.y - d.downPt.y) < 6) return;
      clearTimeout(d.timer);
      if (!beginMove(d.downPt, d.downC)) {
        drag.current = null;
        return;
      }
      onPointerMove(e);
      return;
    }
    if (d.type === 'select') {
      const c = toCanvas(pt.x, pt.y);
      if (d.shape === 'lasso') {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(c.x - last.x, c.y - last.y) * v.zoom > 2) d.pts.push(c);
      } else {
        let { x, y } = c;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(x - d.pts[0].x), Math.abs(y - d.pts[0].y));
          x = d.pts[0].x + Math.sign(x - d.pts[0].x || 1) * m;
          y = d.pts[0].y + Math.sign(y - d.pts[0].y || 1) * m;
        }
        d.pts = [d.pts[0], { x, y }];
      }
      invalidate();
      return;
    }
    if (d.type === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const zoom = Math.min(32, Math.max(0.05, (d.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / d.d0));
      // 두 손가락을 돌리면 화면도 회전 (0°·90° 근처에서는 딱 붙음)
      let rotation = d.r0 + ((Math.atan2(b.y - a.y, b.x - a.x) - d.a0) * 180) / Math.PI;
      const snap = Math.round(rotation / 90) * 90;
      if (Math.abs(rotation - snap) < 5) rotation = snap;
      rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
      v.setView({ zoom, rotation, ...panFor(mx, my, d.cx, d.cy, zoom, rotation) });
      return;
    }
    if (d.type === 'pan') {
      v.setView({ panX: d.px + pt.x - d.sx, panY: d.py + pt.y - d.sy });
      return;
    }
    if (d.type === 'rotateView') {
      let r = d.r0 + ((Math.atan2(pt.y - v.stageH / 2, pt.x - v.stageW / 2) - d.a0) * 180) / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      v.setRotation(r);
      return;
    }
    if (d.type === 'stroke') {
      const sctx = ctx2d(d.stroke);
      sctx.fillStyle = d.erase ? '#000' : d.color;
      const events = (e.nativeEvent.getCoalescedEvents?.() ?? []).length ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
      for (const ev of events) {
        const lp = local(ev);
        const c = toCanvas(lp.x, lp.y);
        const k = 1 - d.smoothing * 0.88;
        d.smooth.x += (c.x - d.smooth.x) * k;
        d.smooth.y += (c.y - d.smooth.y) * k;
        const pr = ev.pointerType === 'pen' && d.pressure ? 0.15 + 0.85 * ev.pressure : 1;
        const size = d.size * pr;
        stamp(sctx, d.last.x, d.last.y, d.last.s, d.smooth.x, d.smooth.y, size);
        d.last = { x: d.smooth.x, y: d.smooth.y, s: size };
      }
      composeStroke(d);
      return;
    }
    if (d.type === 'shape') {
      const c = toCanvas(pt.x, pt.y);
      let { x, y } = c;
      if (e.shiftKey) {
        const dx = x - d.start.x,
          dy = y - d.start.y;
        if (d.kind === 'line') {
          // 45° 단위로 고정
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          x = d.start.x + Math.cos(a) * len;
          y = d.start.y + Math.sin(a) * len;
        } else {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          x = d.start.x + Math.sign(dx || 1) * m;
          y = d.start.y + Math.sign(dy || 1) * m;
        }
      }
      d.end = { x, y };
      const ctx = ctx2d(d.work);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, d.work.width, d.work.height);
      if (d.base) ctx.drawImage(d.base, 0, 0);
      ctx.globalAlpha = d.opacity;
      ctx.globalCompositeOperation = d.alphaLock ? 'source-atop' : 'source-over';
      drawShape(ctx, d.kind, d.start, d.end, d.fill, d.color, d.size);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const work = d.work;
      live.override = { layerId: d.layerId, draw: (c2) => c2.drawImage(work, 0, 0) };
      invalidate();
      return;
    }
    if (d.type === 'transform') {
      const c = toCanvas(pt.x, pt.y);
      const t = { ...d.t0 };
      if (d.mode === 'move') {
        let dx = c.x - d.start.x,
          dy = c.y - d.start.y;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        t.x = d.t0.x + dx;
        t.y = d.t0.y + dy;
      } else if (d.mode === 'scale') {
        const dist = Math.hypot(c.x - d.t0.x, c.y - d.t0.y);
        t.scale = Math.max(0.01, (d.t0.scale * dist) / d.startDist);
      } else {
        let a = d.t0.rotation + ((Math.atan2(c.y - d.t0.y, c.x - d.t0.x) - d.startAngle) * 180) / Math.PI;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        t.rotation = ((a % 360) + 540) % 360 - 180;
      }
      if (d.kind === 'camera') t.scale = Math.min(20, Math.max(0.05, t.scale));
      d.t = t;
      if (d.kind === 'camera') {
        invalidate();
        return;
      }
      if (d.kind === 'selection') {
        updateSelection(t);
        return;
      }
      const src = d.src;
      live.override = { layerId: d.layerId, draw: (ctx) => drawSourceWithTransform(ctx, src, t) };
      invalidate();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d) return;
    if (d.type === 'pinch') {
      if (pointers.current.size < 2) drag.current = null;
      return;
    }
    drag.current = null;
    const s = useEditor.getState();
    const p = s.project!;
    if (d.type === 'pending') {
      // 짧게 눌렀다 뗌: 이미지 레이어 자동 선택만
      clearTimeout(d.timer);
      if (beginMove(d.downPt, d.downC)) drag.current = null;
      invalidate();
      return;
    }
    if (d.type === 'select') {
      const outline = shapeOutline(d.shape, d.pts);
      let area = 0;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i],
          b = outline[(i + 1) % outline.length];
        area += a.x * b.y - b.x * a.y;
      }
      if (Math.abs(area) / 2 < 16) {
        invalidate();
        return;
      }
      if (!makeSelection(d.layerId, d.frameIndex, outline)) s.toast('고른 곳에 그림이 없어요', 'error');
      else s.toast('범위를 골랐어요 · 끌어서 옮기고, 바깥을 누르면 확정 (Esc 취소 · Delete 지우기)', 'success');
      invalidate();
      return;
    }
    if (d.type === 'transform' && d.kind === 'selection') {
      invalidate();
      return;
    }
    if (d.type === 'transform' && d.kind === 'camera') {
      const moved = d.t.x !== d.t0.x || d.t.y !== d.t0.y || d.t.scale !== d.t0.scale || d.t.rotation !== d.t0.rotation;
      if (moved) s.setCameraKey(d.frameIndex, { x: d.t.x, y: d.t.y, zoom: 1 / d.t.scale, rotation: d.t.rotation });
      invalidate();
      return;
    }
    if (d.type === 'shape') {
      live.override = null;
      if (Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y) > 1) s.setCel(d.frameIndex, d.layerId, { kind: 'raster', canvas: d.work }, '도형');
      invalidate();
      return;
    }
    if (d.type === 'stroke') {
      s.setCel(d.frameIndex, d.layerId, { kind: 'raster', canvas: d.work }, d.erase ? '지우개' : '브러시');
      live.override = null;
      invalidate();
      return;
    }
    if (d.type === 'transform') {
      live.override = null;
      const same = d.t.x === d.t0.x && d.t.y === d.t0.y && d.t.scale === d.t0.scale && d.t.rotation === d.t0.rotation;
      if (same) {
        invalidate();
        return;
      }
      if (d.kind === 'image') {
        s.setTransform(d.frameIndex, d.layerId, { x: d.t.x, y: d.t.y, scale: d.t.scale, rotation: d.t.rotation });
      } else {
        const out = createCanvas(p.width, p.height);
        drawSourceWithTransform(ctx2d(out), d.src, d.t);
        s.setCel(d.frameIndex, d.layerId, { kind: 'raster', canvas: out }, '이동/변형');
      }
      invalidate();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const pt = local(e);
    const v = useView.getState();
    const mouseWheel = e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY);
    if (e.ctrlKey || e.metaKey || mouseWheel) {
      v.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey && !mouseWheel ? 0.01 : 0.0015)), pt.x, pt.y);
    } else {
      v.setView({ panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
    }
  };

  const effTool = rHeld ? 'rotate' : spaceHeld ? 'hand' : altHeld && (tool === 'brush' || tool === 'fill') ? 'picker' : tool;
  const cursor =
    effTool === 'rotate'
      ? 'alias'
      : effTool === 'hand'
      ? drag.current?.type === 'pan'
        ? 'grabbing'
        : 'grab'
      : effTool === 'brush' || effTool === 'eraser'
        ? 'none'
        : effTool === 'move' || effTool === 'camera'
          ? 'move'
          : 'crosshair';
  const flipView = useEditor((s) => s.flipView);
  const grid = useEditor((s) => s.grid);

  return (
    <div
      className="stage"
      ref={stageRef}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <canvas
        ref={canvasRef}
        className="view"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          cancelDrag();
        }}
        onPointerLeave={() => {
          hover.current = null;
          schedule();
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {layer && (layer.locked || !layer.visible) && (
        <div className="stage-badge">
          {layer.locked ? <Lock size={13} /> : <EyeOff size={13} />}
          <span>
            <b>{layer.name}</b> {layer.locked ? '레이어가 잠겨 있어요' : '레이어가 숨겨져 있어요'}
          </span>
        </div>
      )}
      <div className="stage-hud">
        <button className="icon-btn sm" onClick={() => useView.getState().zoomAt(1 / 1.25)} title="축소">
          <ZoomOut size={14} />
        </button>
        <button className="zoom" onClick={() => useView.getState().fit()} title="화면 맞춤">
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn sm" onClick={() => useView.getState().zoomAt(1.25)} title="확대">
          <ZoomIn size={14} />
        </button>
        <button className="icon-btn sm" onClick={() => useView.getState().fit()} title="화면 맞춤 (0)">
          <Maximize size={13} />
        </button>
        <span className="hud-sep" />
        <button className="icon-btn sm" onClick={() => useView.getState().setRotation(viewRot - 15)} title="왼쪽으로 15° 돌리기 (R 누른 채 드래그로 자유 회전)">
          <RotateCcw size={13} />
        </button>
        <button className="zoom" style={{ minWidth: 40 }} onClick={() => useView.getState().setRotation(0)} title="회전 원래대로">
          {Math.round(viewRot)}°
        </button>
        <button className="icon-btn sm" onClick={() => useView.getState().setRotation(viewRot + 15)} title="오른쪽으로 15° 돌리기">
          <RotateCw size={13} />
        </button>
        <span className="hud-sep" />
        <button className={'icon-btn sm' + (grid.enabled ? ' active' : '')} onClick={() => useEditor.getState().set({ grid: { ...grid, enabled: !grid.enabled } })} title="격자 (')">
          <Grid3x3 size={13} />
        </button>
        <button className={'icon-btn sm' + (grid.safe ? ' active' : '')} onClick={() => useEditor.getState().set({ grid: { ...grid, safe: !grid.safe } })} title="안전 영역 (영상 가장자리 잘림 확인)">
          <Scan size={13} />
        </button>
        <button className={'icon-btn sm' + (flipView ? ' active' : '')} onClick={() => useEditor.getState().set({ flipView: !flipView })} title="좌우 반전 보기 (M) — 그림 비율 확인용, 실제 그림은 안 바뀌어요">
          <FlipHorizontal2 size={13} />
        </button>
      </div>
      {flipView && (
        <div className="stage-badge" style={{ top: 'auto', bottom: 14, left: 'auto', right: 14, transform: 'none' }}>
          <FlipHorizontal2 size={13} /> 좌우 반전 보기 중
        </div>
      )}
      {dropping && <div className="drop-hint">이미지나 음악 파일을 놓으면 가져와요</div>}
    </div>
  );
}
