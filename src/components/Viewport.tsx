import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, Lock, EyeOff } from 'lucide-react';
import type { Frame, Layer, Project, Transform } from '../types';
import { useEditor, currentLayer } from '../store/editor';
import { useView } from '../store/view';
import { live, invalidate, onInvalidate } from '../lib/live';
import { alphaBounds, checkerPattern, cloneCanvas, createCanvas, ctx2d, floodFillMask, rgbToHex, type Rect } from '../lib/canvas';
import { DEFAULT_T, drawSourceWithTransform, renderFrameCanvas, renderTinted } from '../lib/render';
import { importFiles } from '../lib/importers';

/* ---------------------------------------------------------------- 캐시 */

const boundsCache = new WeakMap<HTMLCanvasElement, Rect | null>();
function rasterBounds(c: HTMLCanvasElement) {
  if (!boundsCache.has(c)) boundsCache.set(c, alphaBounds(c));
  return boundsCache.get(c)!;
}

const onionCache = new Map<string, { frame: Frame; layers: Layer[]; canvas: HTMLCanvasElement }>();
function onionCanvas(p: Project, i: number, tint: string) {
  const f = p.frames[i];
  const key = f.id + tint;
  const hit = onionCache.get(key);
  if (hit && hit.frame === f && hit.layers === p.layers && hit.canvas.width === p.width && hit.canvas.height === p.height) return hit.canvas;
  const canvas = renderTinted(p, i, tint, hit?.canvas);
  onionCache.set(key, { frame: f, layers: p.layers, canvas });
  if (onionCache.size > 40) onionCache.delete(onionCache.keys().next().value!);
  return canvas;
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
      kind: 'image' | 'raster';
      src: CanvasImageSource & { width: number; height: number };
      t0: Transform;
      t: Transform;
      w: number;
      h: number;
      start: { x: number; y: number };
      startAngle: number;
      startDist: number;
    }
  | { type: 'pinch'; d0: number; z0: number; cx: number; cy: number; mx: number; my: number };

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
  const [dropping, setDropping] = useState(false);
  const tool = useEditor((s) => s.tool);
  const layer = useEditor(currentLayer);
  const zoom = useView((s) => s.zoom);
  const fitTick = useView((s) => s.fitTick);
  const projectSize = useEditor((s) => (s.project ? `${s.project.width}x${s.project.height}` : ''));
  const keys = useRef({ space: false, alt: false });

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
    frameBuf.current = renderFrameCanvas(p, s.frameIndex, { background: !showOnion, override: live.override }, frameBuf.current ?? undefined);

    // 종이 그림자
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x0 = v.panX,
      y0 = v.panY,
      pw = p.width * v.zoom,
      ph = p.height * v.zoom;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x0, y0, pw, ph);
    ctx.restore();
    // 배경 (투명이면 체크무늬)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, pw, ph);
    ctx.clip();
    if (p.background) {
      ctx.fillStyle = p.background;
      ctx.fillRect(x0, y0, pw, ph);
    } else {
      ctx.fillStyle = checkerPattern(ctx);
      ctx.fillRect(x0, y0, pw, ph);
    }
    ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * x0, dpr * y0);
    ctx.imageSmoothingEnabled = v.zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    if (showOnion) {
      const { before, after, opacity } = s.onion;
      for (let k = before; k >= 1; k--) {
        const i = s.frameIndex - k;
        const idx = i < 0 ? (s.loop && p.frames.length > 2 ? p.frames.length + i : -1) : i;
        if (idx < 0 || idx === s.frameIndex) continue;
        ctx.globalAlpha = opacity * (1 - (k - 1) / (before + 1));
        ctx.drawImage(onionCanvas(p, idx, '#ff4d6d'), 0, 0);
      }
      for (let k = after; k >= 1; k--) {
        const i = s.frameIndex + k;
        const idx = i >= p.frames.length ? (s.loop && p.frames.length > 2 ? i - p.frames.length : -1) : i;
        if (idx < 0 || idx === s.frameIndex) continue;
        ctx.globalAlpha = opacity * (1 - (k - 1) / (after + 1));
        ctx.drawImage(onionCanvas(p, idx, '#3d8bff'), 0, 0);
      }
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(frameBuf.current, 0, 0);
    ctx.restore();

    // 테두리
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, pw + 1, ph + 1);

    // 변형 상자
    const d = drag.current;
    if (s.tool === 'move' && !s.playing && !keys.current.space) {
      let box: Box | null = null;
      if (d?.type === 'transform') box = { w: d.w, h: d.h, t: d.t };
      else box = targetBox(p, s.frameIndex, s.layerId);
      if (box) {
        const pts = boxCorners(box).map(([x, y]) => [x0 + x * v.zoom, y0 + y * v.zoom]);
        ctx.strokeStyle = '#8b7bff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.stroke();
        const [tl, tr] = pts;
        const mx = (tl[0] + tr[0]) / 2,
          my = (tl[1] + tr[1]) / 2;
        const rot = rotHandle(pts);
        ctx.beginPath();
        ctx.moveTo(mx, my);
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
      }
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

  // 화면 맞춤
  useEffect(() => {
    const p = useEditor.getState().project;
    const v = useView.getState();
    if (!p || !v.stageW) return;
    const z = Math.min((v.stageW - 64) / p.width, (v.stageH - 64) / p.height, 4);
    v.setView({ zoom: z, panX: (v.stageW - p.width * z) / 2, panY: (v.stageH - p.height * z) / 2 });
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
      if (e.key === 'Alt') {
        keys.current.alt = false;
        setAltHeld(false);
        schedule();
      }
    };
    const blur = () => {
      keys.current = { space: false, alt: false };
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
  const toCanvas = (sx: number, sy: number) => {
    const v = useView.getState();
    return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  };

  /* ---------------- 포인터 */
  const cancelDrag = () => {
    drag.current = null;
    live.override = null;
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
      drag.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: v.zoom, cx: c.x, cy: c.y, mx, my };
      return;
    }
    if (pointers.current.size > 2) return;
    if (s.playing) s.set({ playing: false });

    const tool = keys.current.space || e.button === 1 ? 'hand' : keys.current.alt && (s.tool === 'brush' || s.tool === 'fill') ? 'picker' : s.tool;
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

    const lyr = currentLayer(s);
    if (!lyr) return;
    if (lyr.locked) {
      s.toast('잠긴 레이어예요 · 레이어 패널에서 잠금을 풀어 주세요', 'error');
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

    if (tool === 'move') {
      let box = targetBox(p, s.frameIndex, lyr.id);
      let layerId = lyr.id;
      const screenPts = box ? boxCorners(box).map(([x, y]) => [v.panX + x * v.zoom, v.panY + y * v.zoom]) : null;
      let mode: 'move' | 'scale' | 'rotate' | null = null;
      if (box && screenPts) {
        const rh = rotHandle(screenPts);
        if (Math.hypot(pt.x - rh[0], pt.y - rh[1]) < 12) mode = 'rotate';
        else if (screenPts.some(([x, y]) => Math.hypot(pt.x - x, pt.y - y) < 12)) mode = 'scale';
        else if (insideBox(box, c.x, c.y)) mode = 'move';
      }
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
        else return;
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
      return;
    }
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
    if (d.type === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const zoom = Math.min(32, Math.max(0.05, (d.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / d.d0));
      v.setView({ zoom, panX: mx - d.cx * zoom, panY: my - d.cy * zoom });
      return;
    }
    if (d.type === 'pan') {
      v.setView({ panX: d.px + pt.x - d.sx, panY: d.py + pt.y - d.sy });
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
      d.t = t;
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

  const effTool = spaceHeld ? 'hand' : altHeld && (tool === 'brush' || tool === 'fill') ? 'picker' : tool;
  const cursor =
    effTool === 'hand'
      ? drag.current?.type === 'pan'
        ? 'grabbing'
        : 'grab'
      : effTool === 'brush' || effTool === 'eraser'
        ? 'none'
        : effTool === 'move'
          ? 'move'
          : 'crosshair';

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
      </div>
      {dropping && <div className="drop-hint">이미지나 음악 파일을 놓으면 가져와요</div>}
    </div>
  );
}
