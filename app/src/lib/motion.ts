import type { Camera, Cel, Layer, LayerMotion, MotionKind, Project } from '../types';
import { cachedBounds } from './canvas';

export const MOTIONS: { kind: MotionKind; label: string; desc: string }[] = [
  { kind: 'none', label: '없음', desc: '' },
  { kind: 'shake', label: '덜덜 떨림', desc: '무섭거나 추울 때, 화날 때' },
  { kind: 'bob', label: '위아래 둥실', desc: '떠 있는 물건, 숨쉬기' },
  { kind: 'sway', label: '좌우 왔다갔다', desc: '걷는 느낌, 구름' },
  { kind: 'spin', label: '빙글빙글 회전', desc: '바퀴, 별, 로딩' },
  { kind: 'swing', label: '흔들흔들', desc: '나뭇잎, 시계추, 꼬리' },
  { kind: 'pulse', label: '두근두근', desc: '하트, 강조, 숨쉬기' },
];

export const DEFAULT_MOTION: LayerMotion = { kind: 'none', amount: 40, speed: 1 };

/** 프레임마다 정해진 (재현 가능한) -1~1 난수 */
function noise(seed: string, i: number) {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}

export interface MotionOffset {
  dx: number;
  dy: number;
  rot: number;
  scale: number;
}

export function motionOffset(m: LayerMotion | undefined, seed: string, frame: number, fps: number): MotionOffset | null {
  if (!m || m.kind === 'none') return null;
  const t = frame / fps;
  const a = m.amount / 100;
  const w = 2 * Math.PI * m.speed * t;
  switch (m.kind) {
    case 'shake': {
      // 속도가 빠를수록 매 프레임 새로 떨림
      const step = Math.max(1, Math.round(fps / (6 * m.speed)));
      const k = Math.floor(frame / step);
      return { dx: noise(seed, k * 3) * 24 * a, dy: noise(seed, k * 3 + 1) * 24 * a, rot: noise(seed, k * 3 + 2) * 4 * a, scale: 1 };
    }
    case 'bob':
      return { dx: 0, dy: -Math.sin(w) * 60 * a, rot: 0, scale: 1 };
    case 'sway':
      return { dx: Math.sin(w) * 80 * a, dy: 0, rot: 0, scale: 1 };
    case 'spin':
      return { dx: 0, dy: 0, rot: 360 * m.speed * t * (a < 0.5 ? 0.5 : 1), scale: 1 };
    case 'swing':
      return { dx: 0, dy: 0, rot: Math.sin(w) * 35 * a, scale: 1 };
    case 'pulse':
      return { dx: 0, dy: 0, rot: 0, scale: 1 + Math.max(0, Math.sin(w)) * 0.35 * a };
  }
  return null;
}

/** 움직임의 기준점 = 그 프레임 그림의 가운데 */
export function celPivot(p: Project, cel: Cel): { x: number; y: number } {
  if (cel.kind === 'image') return { x: cel.t.x, y: cel.t.y };
  const b = cachedBounds(cel.canvas);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: p.width / 2, y: p.height / 2 };
}

export function applyMotion(ctx: CanvasRenderingContext2D, p: Project, layer: Layer, cel: Cel, frame: number) {
  const o = motionOffset(layer.motion, layer.id, frame, p.fps);
  if (!o) return;
  const c = celPivot(p, cel);
  ctx.translate(c.x + o.dx, c.y + o.dy);
  ctx.rotate((o.rot * Math.PI) / 180);
  ctx.scale(o.scale, o.scale);
  ctx.translate(-c.x, -c.y);
}

/* ---------------------------------------------------------------- 카메라 */

export interface CamView {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export const defaultCamera = (): Camera => ({ enabled: false, keys: [], ease: 'smooth', shake: 0 });
export const homeView = (p: Project): CamView => ({ x: p.width / 2, y: p.height / 2, zoom: 1, rotation: 0 });

/** 키가 있는 프레임 번호 순서대로 */
export function cameraKeysByIndex(p: Project) {
  const cam = p.camera;
  if (!cam) return [];
  const idx = new Map(p.frames.map((f, i) => [f.id, i]));
  return cam.keys
    .map((k) => ({ k, i: idx.get(k.frameId) ?? -1 }))
    .filter((e) => e.i >= 0)
    .sort((a, b) => a.i - b.i);
}

/** 프레임 i 에서 카메라가 보는 곳 (키 사이는 자동으로 이어짐). 흔들림은 withShake 일 때만 */
export function cameraAt(p: Project, i: number, withShake = false): CamView {
  const keys = cameraKeysByIndex(p);
  let v: CamView = homeView(p);
  if (keys.length) {
    if (i <= keys[0].i) v = { ...keys[0].k };
    else if (i >= keys[keys.length - 1].i) v = { ...keys[keys.length - 1].k };
    else {
      const n = keys.findIndex((e) => e.i > i);
      const a = keys[n - 1],
        b = keys[n];
      let t = (i - a.i) / (b.i - a.i);
      if (p.camera!.ease === 'smooth') t = t * t * (3 - 2 * t);
      const L = (x: number, y: number) => x + (y - x) * t;
      v = { x: L(a.k.x, b.k.x), y: L(a.k.y, b.k.y), zoom: L(a.k.zoom, b.k.zoom), rotation: L(a.k.rotation, b.k.rotation) };
    }
  }
  const shake = p.camera?.shake ?? 0;
  if (withShake && shake > 0) {
    const s = shake / 100;
    v = { ...v, x: v.x + noise('cam', i * 3) * 30 * s, y: v.y + noise('cam', i * 3 + 1) * 30 * s, rotation: v.rotation + noise('cam', i * 3 + 2) * 3 * s };
  }
  return { x: v.x, y: v.y, zoom: v.zoom, rotation: v.rotation };
}

export function cameraActive(p: Project) {
  return !!p.camera?.enabled && (p.camera.keys.length > 0 || p.camera.shake > 0);
}

/** 출력 화면 = 카메라가 본 모습이 되도록 ctx 를 바꾼다 */
export function applyCamera(ctx: CanvasRenderingContext2D, p: Project, i: number) {
  const c = cameraAt(p, i, true);
  ctx.translate(p.width / 2, p.height / 2);
  ctx.rotate((-c.rotation * Math.PI) / 180);
  ctx.scale(c.zoom, c.zoom);
  ctx.translate(-c.x, -c.y);
}
