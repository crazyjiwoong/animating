import { create } from 'zustand';
import type { Asset, AudioTrack, Camera, CameraKey, Cel, Frame, Layer, LayerKind, Project, RefVideo, Tool, Transform } from '../types';
import { cameraAt, defaultCamera } from '../lib/motion';
import { uid, clamp } from '../lib/id';
import { createCanvas, ctx2d } from '../lib/canvas';
import { DEFAULT_T, drawCel, renderFrameCanvas } from '../lib/render';

export const LAYER_COLORS = ['#8b7bff', '#ff6fb5', '#45b8ff', '#5ee38c', '#ffb340', '#ff5d73', '#3fd6c6', '#c06bff'];

type Snapshot = Pick<Project, 'layers' | 'frames' | 'width' | 'height' | 'background' | 'fps' | 'name' | 'camera'> & {
  frameIndex: number;
  layerId: string;
  label: string;
  key?: string;
  at: number;
};

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface BrushSettings {
  size: number;
  opacity: number;
  smoothing: number;
  pressure: boolean;
}

export type Dialog =
  | { type: 'frame'; index: number }
  | { type: 'settings'; tab?: 'project' | 'view' }
  | { type: 'export' }
  | { type: 'shortcuts' }
  | { type: 'audio' }
  | { type: 'imageImport'; files: File[] };

export type ShapeKind = 'line' | 'rect' | 'ellipse';
/** 이동 도구에서 꾹 눌러 범위를 지정할 때의 모양 */
export type SelShape = 'lasso' | 'rect' | 'ellipse';
export interface OnionSettings {
  enabled: boolean;
  before: number;
  after: number;
  opacity: number;
  /** plain = 원래 색 그대로 반투명, tint = 이전 빨강/다음 파랑 */
  mode: 'plain' | 'tint';
  /** 길게 늘린(같은) 그림은 건너뛰고 이전 '다른' 그림을 보여준다 */
  skipSame: boolean;
}

interface CelClipboard {
  cel: Cel;
  kind: LayerKind;
}

export interface EditorState {
  project: Project | null;
  dirty: boolean;
  savedAt: number | null;
  frameIndex: number;
  layerId: string;
  past: Snapshot[];
  future: Snapshot[];

  tool: Tool;
  brush: BrushSettings;
  eraser: BrushSettings;
  fill: { tolerance: number; allLayers: boolean };
  color: string;
  recentColors: string[];
  onion: OnionSettings;
  shape: { kind: ShapeKind; fill: boolean };
  selShape: SelShape;
  /** 재생할 때 카메라가 보는 화면으로 미리보기 */
  cameraView: boolean;
  /** 범위를 지정해 떠 있는 그림이 있는지 (화면 표시용) */
  selectionActive: boolean;
  grid: { enabled: boolean; size: number; safe: boolean };
  flipView: boolean;
  playSpeed: number;
  exposureMode: 'ripple' | 'overwrite';
  playing: boolean;
  loop: boolean;
  scrubSound: boolean;
  timelineCol: number;
  clipboard: CelClipboard | null;
  toasts: Toast[];
  rightPanelOpen: boolean;
  dialog: Dialog | null;
  timelineH: number;

  /* ---- 프로젝트 ---- */
  openProject: (p: Project) => void;
  closeProject: () => void;
  markSaved: (at: number) => void;
  commit: (label: string, fn: (p: Project) => Partial<Project> | void, opts?: { key?: string }) => void;
  undo: () => void;
  redo: () => void;

  /* ---- 선택 ---- */
  setFrame: (i: number) => void;
  setLayer: (id: string) => void;
  set: (patch: Partial<EditorState>) => void;
  setColor: (c: string, remember?: boolean) => void;
  toast: (text: string, kind?: Toast['kind']) => void;

  /* ---- 레이어 ---- */
  addLayer: (kind?: LayerKind, name?: string) => string;
  deleteLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  moveLayer: (id: string, dir: 1 | -1) => void;
  reorderLayer: (id: string, toIndex: number) => void;
  updateLayer: (id: string, patch: Partial<Layer>, key?: string) => void;
  mergeDown: (id: string) => void;
  rasterizeLayer: (id: string) => void;

  /* ---- 프레임 ---- */
  addFrame: (afterIndex?: number) => void;
  insertEmptyFrames: (afterIndex: number, count: number) => void;
  duplicateFrame: (index: number, count: number) => void;
  deleteFrame: (index: number) => void;
  moveFrame: (from: number, to: number) => void;
  clearFrame: (index: number) => void;
  setMemo: (index: number, memo: string) => void;

  /* ---- 셀 ---- */
  setCel: (frameIndex: number, layerId: string, cel: Cel | null, label: string, key?: string) => void;
  /** 이 프레임에 카메라 키를 만들거나 고친다 (처음이면 카메라 켜기) */
  setCameraKey: (frameIndex: number, v: Partial<Omit<CameraKey, 'frameId'>>, key?: string) => void;
  deleteCameraKey: (frameIndex: number) => void;
  updateCamera: (patch: Partial<Camera>, key?: string) => void;
  setExposure: (layerId: string, start: number, end: number, length: number, mode?: 'ripple' | 'overwrite') => void;
  splitRun: (layerId: string, frameIndex: number) => void;
  setTransform: (frameIndex: number, layerId: string, t: Partial<Transform>, key?: string) => void;
  copyCel: () => void;
  pasteCel: () => void;
  copyTransformFromPrev: () => void;

  /* ---- 에셋/오디오/설정 ---- */
  addAsset: (a: Asset) => void;
  importImage: (blob: Blob, name: string, bitmap: ImageBitmap) => void;
  importImageSequence: (items: { blob: Blob; name: string; bitmap: ImageBitmap }[]) => void;
  replaceImage: (blob: Blob, name: string, bitmap: ImageBitmap) => void;
  setAudio: (a: AudioTrack | null) => void;
  updateAudio: (patch: Partial<AudioTrack>) => void;
  updateSettings: (patch: Partial<Pick<Project, 'name' | 'fps' | 'width' | 'height' | 'background'>>) => void;
  extendToAudio: () => void;
  setRefVideo: (r: RefVideo | null) => void;
  updateRefVideo: (patch: Partial<RefVideo>) => void;
  extendToRefVideo: () => void;
}

const HISTORY_LIMIT = 60;

export function makeLayer(kind: LayerKind, name: string, index: number): Layer {
  return {
    id: uid('l_'),
    name,
    kind,
    visible: true,
    locked: false,
    alphaLock: false,
    opacity: 1,
    blend: 'source-over',
    color: LAYER_COLORS[index % LAYER_COLORS.length],
  };
}

export function makeProject(opts: { name: string; width: number; height: number; fps: number; background: string | null }): Project {
  const layer = makeLayer('raster', '레이어 1', 0);
  const now = Date.now();
  return {
    id: uid('p_'),
    ...opts,
    layers: [layer],
    frames: [{ id: uid('f_'), cels: {} }],
    assets: {},
    audio: null,
    createdAt: now,
    updatedAt: now,
  };
}

function cloneFrame(f: Frame): Frame {
  // 비트맵은 불변이므로 공유하고, key 는 새로 줘서 복제본을 따로 편집할 수 있게 한다
  const cels: Record<string, Cel> = {};
  for (const [k, c] of Object.entries(f.cels)) cels[k] = c.kind === 'image' ? { ...c, key: uid('c_'), t: { ...c.t } } : { ...c, key: uid('c_') };
  return { id: uid('f_'), cels, memo: f.memo };
}

/** frameIndex 의 셀과 같은 그림(key)이 이어지는 구간 [start, end] */
export function runAt(frames: Frame[], layerId: string, frameIndex: number): [number, number] {
  const key = frames[frameIndex]?.cels[layerId]?.key;
  if (!key) return [frameIndex, frameIndex];
  let a = frameIndex;
  while (a > 0 && frames[a - 1].cels[layerId]?.key === key) a--;
  let b = frameIndex;
  while (b < frames.length - 1 && frames[b + 1].cels[layerId]?.key === key) b++;
  return [a, b];
}

/** 프레임 배열에서 한 레이어의 셀 열을 바꿔 끼운다 (필요하면 프레임 추가) */
function writeColumn(frames: Frame[], layerId: string, col: (Cel | undefined)[]): Frame[] {
  const out = [...frames];
  while (out.length < col.length) out.push({ id: uid('f_'), cels: {} });
  return out.map((f, i) => {
    const c = col[i];
    if (f.cels[layerId] === c) return f;
    const cels = { ...f.cels };
    if (c) cels[layerId] = c;
    else delete cels[layerId];
    return { ...f, cels };
  });
}

function nextLayerName(layers: Layer[], base: string) {
  let n = layers.length + 1;
  const names = new Set(layers.map((l) => l.name));
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  dirty: false,
  savedAt: null,
  frameIndex: 0,
  layerId: '',
  past: [],
  future: [],

  tool: 'brush',
  brush: { size: 6, opacity: 1, smoothing: 0.35, pressure: true },
  eraser: { size: 24, opacity: 1, smoothing: 0.2, pressure: false },
  fill: { tolerance: 24, allLayers: true },
  color: '#1d1f2b',
  recentColors: ['#1d1f2b', '#ffffff', '#ff5d73', '#ffb340', '#ffd23f', '#5ee38c', '#45b8ff', '#8b7bff'],
  onion: { enabled: true, before: 1, after: 0, opacity: 0.3, mode: 'plain', skipSame: true },
  shape: { kind: 'rect', fill: false },
  selShape: 'lasso',
  cameraView: true,
  selectionActive: false,
  grid: { enabled: false, size: 64, safe: false },
  flipView: false,
  playSpeed: 1,
  exposureMode: 'ripple',
  playing: false,
  loop: true,
  scrubSound: true,
  timelineCol: 56,
  clipboard: null,
  toasts: [],
  rightPanelOpen: typeof window === 'undefined' || window.innerWidth > 1000,
  dialog: null,
  timelineH: 268,

  openProject: (p) =>
    set({
      project: p,
      dirty: false,
      savedAt: p.updatedAt,
      frameIndex: 0,
      layerId: p.layers[p.layers.length - 1]?.id ?? '',
      past: [],
      future: [],
      playing: false,
    }),
  closeProject: () => set({ project: null, past: [], future: [], playing: false, dialog: null }),
  markSaved: (at) => set({ dirty: false, savedAt: at }),

  commit: (label, fn, opts) => {
    const s = get();
    const p = s.project;
    if (!p) return;
    const patch = fn(p);
    if (!patch) return;
    const now = Date.now();
    const last = s.past[s.past.length - 1];
    const coalesce = opts?.key && last && last.key === opts.key && now - last.at < 1200;
    const snap: Snapshot = {
      layers: p.layers,
      frames: p.frames,
      camera: p.camera,
      width: p.width,
      height: p.height,
      background: p.background,
      fps: p.fps,
      name: p.name,
      frameIndex: s.frameIndex,
      layerId: s.layerId,
      label,
      key: opts?.key,
      at: now,
    };
    let past = s.past;
    if (coalesce) past = [...past.slice(0, -1), { ...last, at: now }];
    else past = [...past, snap].slice(-HISTORY_LIMIT);
    const next = { ...p, ...patch, updatedAt: now };
    set({
      project: next,
      past,
      future: [],
      dirty: true,
      frameIndex: clamp(s.frameIndex, 0, next.frames.length - 1),
    });
  },

  undo: () => {
    const s = get();
    const p = s.project;
    const snap = s.past[s.past.length - 1];
    if (!p || !snap) return;
    const cur: Snapshot = { ...snap, layers: p.layers, frames: p.frames, camera: p.camera, width: p.width, height: p.height, background: p.background, fps: p.fps, name: p.name, frameIndex: s.frameIndex, layerId: s.layerId };
    set({
      project: { ...p, layers: snap.layers, frames: snap.frames, camera: snap.camera, width: snap.width, height: snap.height, background: snap.background, fps: snap.fps, name: snap.name },
      past: s.past.slice(0, -1),
      future: [...s.future, cur],
      frameIndex: clamp(snap.frameIndex, 0, snap.frames.length - 1),
      layerId: snap.layers.some((l) => l.id === snap.layerId) ? snap.layerId : snap.layers[snap.layers.length - 1]?.id ?? '',
      dirty: true,
    });
    get().toast(`실행 취소: ${snap.label}`);
  },

  redo: () => {
    const s = get();
    const p = s.project;
    const snap = s.future[s.future.length - 1];
    if (!p || !snap) return;
    const cur: Snapshot = { ...snap, layers: p.layers, frames: p.frames, camera: p.camera, width: p.width, height: p.height, background: p.background, fps: p.fps, name: p.name, frameIndex: s.frameIndex, layerId: s.layerId, key: undefined };
    set({
      project: { ...p, layers: snap.layers, frames: snap.frames, camera: snap.camera, width: snap.width, height: snap.height, background: snap.background, fps: snap.fps, name: snap.name },
      future: s.future.slice(0, -1),
      past: [...s.past, cur],
      frameIndex: clamp(snap.frameIndex, 0, snap.frames.length - 1),
      layerId: snap.layers.some((l) => l.id === snap.layerId) ? snap.layerId : snap.layers[snap.layers.length - 1]?.id ?? '',
      dirty: true,
    });
    get().toast(`다시 실행: ${snap.label}`);
  },

  setFrame: (i) => {
    const p = get().project;
    if (!p) return;
    set({ frameIndex: clamp(i, 0, p.frames.length - 1) });
  },
  setLayer: (id) => set({ layerId: id }),
  set: (patch) => set(patch),
  setColor: (c, remember = true) => {
    const s = get();
    set({
      color: c,
      recentColors: remember ? [c, ...s.recentColors.filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 16) : s.recentColors,
    });
  },
  toast: (text, kind = 'info') => {
    const id = uid('t');
    set((s) => ({ toasts: [...s.toasts.slice(-1), { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2600);
  },

  /* ---------------------------------------------------------------- 레이어 */

  addLayer: (kind = 'raster', name) => {
    const s = get();
    const p = s.project!;
    const layer = makeLayer(kind, name ?? nextLayerName(p.layers, kind === 'image' ? '이미지' : '레이어'), p.layers.length);
    const idx = p.layers.findIndex((l) => l.id === s.layerId);
    const at = idx < 0 ? p.layers.length : idx + 1;
    s.commit('레이어 추가', (p) => ({ layers: [...p.layers.slice(0, at), layer, ...p.layers.slice(at)] }));
    set({ layerId: layer.id });
    return layer.id;
  },

  deleteLayer: (id) => {
    const s = get();
    const p = s.project!;
    if (p.layers.length <= 1) {
      s.toast('마지막 레이어는 삭제할 수 없어요', 'error');
      return;
    }
    const idx = p.layers.findIndex((l) => l.id === id);
    s.commit('레이어 삭제', (p) => ({
      layers: p.layers.filter((l) => l.id !== id),
      frames: p.frames.map((f) => {
        if (!f.cels[id]) return f;
        const cels = { ...f.cels };
        delete cels[id];
        return { ...f, cels };
      }),
    }));
    const layers = get().project!.layers;
    set({ layerId: layers[Math.max(0, idx - 1)]?.id ?? layers[0].id });
  },

  duplicateLayer: (id) => {
    const s = get();
    const p = s.project!;
    const idx = p.layers.findIndex((l) => l.id === id);
    const src = p.layers[idx];
    const copy: Layer = { ...src, id: uid('l_'), name: `${src.name} 복사` };
    const keyMap = new Map<string, string>();
    const newKey = (k?: string) => {
      if (!k) return uid('c_');
      if (!keyMap.has(k)) keyMap.set(k, uid('c_'));
      return keyMap.get(k)!;
    };
    s.commit('레이어 복제', (p) => ({
      layers: [...p.layers.slice(0, idx + 1), copy, ...p.layers.slice(idx + 1)],
      frames: p.frames.map((f) => {
        const c = f.cels[id];
        if (!c) return f;
        return { ...f, cels: { ...f.cels, [copy.id]: c.kind === 'image' ? { ...c, key: newKey(c.key), t: { ...c.t } } : { ...c, key: newKey(c.key) } } };
      }),
    }));
    set({ layerId: copy.id });
  },

  moveLayer: (id, dir) => {
    const p = get().project!;
    const idx = p.layers.findIndex((l) => l.id === id);
    get().reorderLayer(id, idx + dir);
  },

  reorderLayer: (id, toIndex) => {
    const p = get().project!;
    const idx = p.layers.findIndex((l) => l.id === id);
    const to = clamp(toIndex, 0, p.layers.length - 1);
    if (idx === to || idx < 0) return;
    get().commit('레이어 순서 변경', (p) => {
      const layers = [...p.layers];
      const [l] = layers.splice(idx, 1);
      layers.splice(to, 0, l);
      return { layers };
    });
  },

  updateLayer: (id, patch, key) => {
    get().commit(
      '레이어 속성',
      (p) => ({ layers: p.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }),
      key ? { key: `${key}:${id}` } : undefined,
    );
  },

  mergeDown: (id) => {
    const s = get();
    const p = s.project!;
    const idx = p.layers.findIndex((l) => l.id === id);
    if (idx <= 0) {
      s.toast('아래에 합칠 레이어가 없어요', 'error');
      return;
    }
    const upper = p.layers[idx];
    const lower = p.layers[idx - 1];
    const merged = new Map<string, Cel>();
    const mini: Project = {
      ...p,
      camera: undefined,
      layers: [
        { ...lower, visible: true, opacity: 1, blend: 'source-over', clip: false },
        // 아래 레이어도 클리핑 중이면 위 레이어는 같은 바탕에 붙어 있던 것 — 아래 모양에 다시 자르지 않는다
        { ...upper, clip: !!upper.clip && !lower.clip },
      ],
    };
    s.commit('아래 레이어와 합치기', (p) => ({
      layers: p.layers.filter((l) => l.id !== upper.id).map((l) => (l.id === lower.id ? { ...l, kind: 'raster' as const, fx: undefined } : l)),
      frames: p.frames.map((f, fi) => {
        const a = f.cels[lower.id];
        const b = f.cels[upper.id];
        const cels = { ...f.cels };
        delete cels[upper.id];
        if (!a && !b) return { ...f, cels };
        const pair = a?.key || b?.key ? `${a?.key ?? '-'}|${b?.key ?? '-'}` : null;
        if (pair && merged.has(pair)) {
          cels[lower.id] = merged.get(pair)!;
          return { ...f, cels };
        }
        // 두 레이어만 있는 작은 작품으로 그려서 클리핑·색 효과까지 그대로 굳힌다
        const c = renderFrameCanvas(mini, fi, { background: false });
        const cel: Cel = { kind: 'raster', key: uid('c_'), canvas: c };
        if (pair) merged.set(pair, cel);
        cels[lower.id] = cel;
        return { ...f, cels };
      }),
    }));
    set({ layerId: lower.id });
  },

  rasterizeLayer: (id) => {
    const s = get();
    const done = new Map<string, Cel>();
    s.commit('래스터화', (p) => ({
      layers: p.layers.map((l) => (l.id === id ? { ...l, kind: 'raster' as const } : l)),
      frames: p.frames.map((f) => {
        const cel = f.cels[id];
        if (!cel || cel.kind === 'raster') return f;
        const hit = cel.key && done.get(cel.key);
        if (hit) return { ...f, cels: { ...f.cels, [id]: hit } };
        const c = createCanvas(p.width, p.height);
        drawCel(ctx2d(c), p, cel);
        const out: Cel = { kind: 'raster', key: cel.key ?? uid('c_'), canvas: c };
        if (cel.key) done.set(cel.key, out);
        return { ...f, cels: { ...f.cels, [id]: out } };
      }),
    }));
  },

  /* ---------------------------------------------------------------- 프레임 */

  addFrame: (afterIndex) => {
    const s = get();
    const at = (afterIndex ?? s.frameIndex) + 1;
    s.commit('프레임 추가', (p) => ({ frames: [...p.frames.slice(0, at), { id: uid('f_'), cels: {} }, ...p.frames.slice(at)] }));
    set({ frameIndex: at });
  },

  insertEmptyFrames: (afterIndex, count) => {
    const s = get();
    const at = afterIndex + 1;
    const n = clamp(Math.round(count), 1, 500);
    const add = Array.from({ length: n }, () => ({ id: uid('f_'), cels: {} }));
    s.commit(`빈 프레임 ${n}개 추가`, (p) => ({ frames: [...p.frames.slice(0, at), ...add, ...p.frames.slice(at)] }));
    set({ frameIndex: at });
  },

  duplicateFrame: (index, count) => {
    const s = get();
    const p = s.project!;
    const src = p.frames[index];
    if (!src) return;
    const n = clamp(Math.round(count), 1, 500);
    const copies = Array.from({ length: n }, () => cloneFrame(src));
    s.commit(`같은 그림 ${n}개 추가`, (p) => ({
      frames: [...p.frames.slice(0, index + 1), ...copies, ...p.frames.slice(index + 1)],
    }));
    set({ frameIndex: index + 1 });
    if (n > 1) s.toast(`프레임 ${index + 1}과 같은 그림 ${n}개를 추가했어요`, 'success');
  },

  deleteFrame: (index) => {
    const s = get();
    const p = s.project!;
    if (p.frames.length <= 1) {
      s.commit('프레임 비우기', () => ({ frames: [{ id: uid('f_'), cels: {} }] }));
      return;
    }
    s.commit('프레임 삭제', (p) => ({ frames: p.frames.filter((_, i) => i !== index) }));
    set({ frameIndex: clamp(index, 0, p.frames.length - 2) });
  },

  moveFrame: (from, to) => {
    const s = get();
    const p = s.project!;
    to = clamp(to, 0, p.frames.length - 1);
    if (from === to) return;
    s.commit('프레임 이동', (p) => {
      const frames = [...p.frames];
      const [f] = frames.splice(from, 1);
      frames.splice(to, 0, f);
      return { frames };
    });
    set({ frameIndex: to });
  },

  clearFrame: (index) => {
    get().commit('프레임 비우기', (p) => ({ frames: p.frames.map((f, i) => (i === index ? { ...f, cels: {} } : f)) }));
  },

  setMemo: (index, memo) => {
    get().commit('메모', (p) => ({ frames: p.frames.map((f, i) => (i === index ? { ...f, memo } : f)) }), { key: `memo:${index}` });
  },

  /* ---------------------------------------------------------------- 셀 */

  setCel: (frameIndex, layerId, cel, label, key) => {
    get().commit(
      label,
      (p) => {
        // 길게 늘린 그림이면 그 구간 전체가 함께 바뀐다
        const [a, b] = runAt(p.frames, layerId, frameIndex);
        const old = p.frames[frameIndex]?.cels[layerId];
        const next: Cel | null = cel ? { ...cel, key: old?.key ?? uid('c_') } : null;
        return {
          frames: p.frames.map((f, i) => {
            if (i < a || i > b) return f;
            const cels = { ...f.cels };
            if (next) cels[layerId] = next;
            else delete cels[layerId];
            return { ...f, cels };
          }),
        };
      },
      key ? { key } : undefined,
    );
  },

  setCameraKey: (frameIndex, v, key) => {
    const s = get();
    const p = s.project!;
    const f = p.frames[frameIndex];
    if (!f) return;
    const cam = p.camera ?? defaultCamera();
    const cur = cameraAt(p, frameIndex);
    const old = cam.keys.find((k) => k.frameId === f.id);
    const next: CameraKey = { ...(old ?? { frameId: f.id, ...cur }), ...v, frameId: f.id };
    s.commit(
      old ? '카메라 키 수정' : '카메라 키 추가',
      () => ({ camera: { ...cam, enabled: true, keys: [...cam.keys.filter((k) => k.frameId !== f.id), next] } }),
      key ? { key } : undefined,
    );
  },

  deleteCameraKey: (frameIndex) => {
    const s = get();
    const p = s.project!;
    const f = p.frames[frameIndex];
    if (!f || !p.camera?.keys.some((k) => k.frameId === f.id)) return;
    s.commit('카메라 키 삭제', (p) => ({ camera: { ...p.camera!, keys: p.camera!.keys.filter((k) => k.frameId !== f.id) } }));
  },

  updateCamera: (patch, key) => {
    get().commit('카메라 설정', (p) => ({ camera: { ...(p.camera ?? defaultCamera()), ...patch } }), key ? { key } : undefined);
  },

  setExposure: (layerId, start, end, length, mode) => {
    const s = get();
    const p = s.project!;
    const cel = p.frames[start]?.cels[layerId];
    if (!cel) return;
    const len = clamp(Math.round(length), 1, 5000);
    if (len === end - start + 1) return;
    const m = mode ?? s.exposureMode;
    const col: (Cel | undefined)[] = p.frames.map((f) => f.cels[layerId]);
    let next: (Cel | undefined)[];
    if (m === 'ripple') {
      next = [...col.slice(0, start), ...Array<Cel>(len).fill(cel), ...col.slice(end + 1)];
    } else {
      next = [...col];
      for (let i = start; i < start + len; i++) next[i] = cel;
      for (let i = start + len; i <= end; i++) next[i] = undefined;
    }
    s.commit('노출 길이', (p) => ({ frames: writeColumn(p.frames, layerId, next) }));
  },

  splitRun: (layerId, frameIndex) => {
    const s = get();
    const p = s.project!;
    const [a, b] = runAt(p.frames, layerId, frameIndex);
    if (a === b) return;
    const cel = p.frames[frameIndex].cels[layerId]!;
    // 앞쪽은 그대로, frameIndex 부터는 새 그림으로 (frameIndex 가 첫 칸이면 그 칸만 분리)
    const from = frameIndex === a ? a + 1 : frameIndex;
    const piece: Cel = cel.kind === 'image' ? { ...cel, key: uid('c_'), t: { ...cel.t } } : { ...cel, key: uid('c_') };
    s.commit('그림 나누기', (p) => ({
      frames: p.frames.map((f, i) => (i >= from && i <= b ? { ...f, cels: { ...f.cels, [layerId]: piece } } : f)),
    }));
    s.toast(`프레임 ${from + 1}부터 따로 편집할 수 있어요`, 'success');
  },



  setTransform: (frameIndex, layerId, t, key) => {
    const p = get().project!;
    const cel = p.frames[frameIndex]?.cels[layerId];
    if (!cel || cel.kind !== 'image') return;
    get().setCel(frameIndex, layerId, { ...cel, t: { ...cel.t, ...t } }, '변형', key);
  },

  copyCel: () => {
    const s = get();
    const p = s.project;
    if (!p) return;
    const cel = p.frames[s.frameIndex]?.cels[s.layerId];
    const layer = p.layers.find((l) => l.id === s.layerId);
    if (!cel || !layer) {
      s.toast('복사할 내용이 없어요');
      return;
    }
    set({ clipboard: { cel, kind: layer.kind } });
    s.toast('셀을 복사했어요');
  },

  pasteCel: () => {
    const s = get();
    const p = s.project;
    const clip = s.clipboard;
    if (!p || !clip) return;
    const layer = p.layers.find((l) => l.id === s.layerId);
    if (!layer || layer.locked) return;
    let cel: Cel = clip.cel;
    if (layer.kind === 'raster' && cel.kind === 'image') {
      const c = createCanvas(p.width, p.height);
      drawCel(ctx2d(c), p, cel);
      cel = { kind: 'raster', canvas: c };
    } else if (layer.kind === 'image' && cel.kind === 'raster') {
      s.toast('래스터 셀은 래스터 레이어에만 붙여넣을 수 있어요', 'error');
      return;
    } else if (cel.kind === 'image') cel = { ...cel, t: { ...cel.t } };
    s.setCel(s.frameIndex, layer.id, { ...cel, key: undefined }, '셀 붙여넣기');
  },

  copyTransformFromPrev: () => {
    const s = get();
    const p = s.project!;
    const prev = p.frames[s.frameIndex - 1]?.cels[s.layerId];
    if (!prev || prev.kind !== 'image') {
      s.toast('이전 프레임에 같은 이미지가 없어요');
      return;
    }
    s.setCel(s.frameIndex, s.layerId, { ...prev, t: { ...prev.t } }, '이전 프레임 위치 복사');
  },

  /* ---------------------------------------------------------------- 에셋 / 오디오 / 설정 */

  addAsset: (a) => set((s) => (s.project ? { project: { ...s.project, assets: { ...s.project.assets, [a.id]: a } } } : {})),

  importImage: (blob, name, bitmap) => {
    const s = get();
    const p = s.project!;
    const asset: Asset = { id: uid('a_'), name, blob, bitmap, width: bitmap.width, height: bitmap.height };
    s.addAsset(asset);
    const fit = Math.min(1, (p.width * 0.9) / bitmap.width, (p.height * 0.9) / bitmap.height);
    const centered: Transform = { ...DEFAULT_T, x: p.width / 2, y: p.height / 2, scale: fit };

    // 선택한 이미지 레이어의 현재 프레임이 비어 있으면 그 자리에 넣는다 (프레임마다 그림 바꾸기)
    const cur = p.layers.find((l) => l.id === s.layerId);
    if (cur && cur.kind === 'image' && !cur.locked && !p.frames[s.frameIndex].cels[cur.id]) {
      let prev: Transform | null = null;
      for (let i = s.frameIndex - 1; i >= 0 && !prev; i--) {
        const c = p.frames[i].cels[cur.id];
        if (c?.kind === 'image') prev = c.t;
      }
      s.setCel(s.frameIndex, cur.id, { kind: 'image', assetId: asset.id, t: prev ? { ...prev } : centered }, '이미지 넣기');
      set({ tool: 'move' });
      s.toast(`'${cur.name}' 레이어의 프레임 ${s.frameIndex + 1}에 넣었어요`, 'success');
      return;
    }

    const layer = makeLayer('image', name.replace(/\.[a-z0-9]+$/i, '').slice(0, 24) || '이미지', p.layers.length);
    const idx = p.layers.findIndex((l) => l.id === s.layerId);
    const at = idx < 0 ? p.layers.length : idx + 1;
    s.commit('이미지 가져오기', (p) => ({
      layers: [...p.layers.slice(0, at), layer, ...p.layers.slice(at)],
      frames: p.frames.map((f, i) => (i === s.frameIndex ? { ...f, cels: { ...f.cels, [layer.id]: { kind: 'image', key: uid('c_'), assetId: asset.id, t: centered } } } : f)),
    }));
    set({ layerId: layer.id, tool: 'move' });
    s.toast('이미지를 새 레이어로 가져왔어요 · 이동 도구로 위치를 조절하세요', 'success');
  },

  importImageSequence: (items) => {
    const s = get();
    const p = s.project!;
    if (!items.length) return;
    const assets = items.map(({ blob, name, bitmap }) => ({ id: uid('a_'), name, blob, bitmap, width: bitmap.width, height: bitmap.height }));
    assets.forEach((a) => s.addAsset(a));
    // 모든 장에 같은 배율을 써서 크기 관계를 유지한다
    const maxW = Math.max(...assets.map((a) => a.width));
    const maxH = Math.max(...assets.map((a) => a.height));
    const fit = Math.min(1, (p.width * 0.9) / maxW, (p.height * 0.9) / maxH);
    const layer = makeLayer('image', `시퀀스 ${assets.length}장`, p.layers.length);
    const idx = p.layers.findIndex((l) => l.id === s.layerId);
    const at = idx < 0 ? p.layers.length : idx + 1;
    const startF = s.frameIndex;
    s.commit(`이미지 ${assets.length}장 시퀀스`, (p) => {
      const frames = [...p.frames];
      while (frames.length < startF + assets.length) frames.push({ id: uid('f_'), cels: {} });
      assets.forEach((a, k) => {
        const f = frames[startF + k];
        frames[startF + k] = { ...f, cels: { ...f.cels, [layer.id]: { kind: 'image', key: uid('c_'), assetId: a.id, t: { ...DEFAULT_T, x: p.width / 2, y: p.height / 2, scale: fit } } } };
      });
      return { layers: [...p.layers.slice(0, at), layer, ...p.layers.slice(at)], frames };
    });
    set({ layerId: layer.id });
    s.toast(`이미지 ${assets.length}장을 프레임 ${startF + 1}~${startF + assets.length}에 넣었어요`, 'success');
  },

  replaceImage: (blob, name, bitmap) => {
    const s = get();
    const p = s.project!;
    const cel = p.frames[s.frameIndex]?.cels[s.layerId];
    if (!cel || cel.kind !== 'image') return;
    const asset: Asset = { id: uid('a_'), name, blob, bitmap, width: bitmap.width, height: bitmap.height };
    s.addAsset(asset);
    s.setCel(s.frameIndex, s.layerId, { ...cel, assetId: asset.id, t: { ...cel.t } }, '이미지 교체');
    s.toast('이 프레임의 이미지를 바꿨어요 (위치·크기는 그대로)', 'success');
  },

  setAudio: (a) => set((s) => (s.project ? { project: { ...s.project, audio: a }, dirty: true } : {})),
  updateAudio: (patch) =>
    set((s) => (s.project?.audio ? { project: { ...s.project, audio: { ...s.project.audio, ...patch } }, dirty: true } : {})),

  updateSettings: (patch) => {
    const s = get();
    const p = s.project!;
    const w = patch.width ?? p.width;
    const h = patch.height ?? p.height;
    const resized = w !== p.width || h !== p.height;
    s.commit('작품 설정', (p) => {
      if (!resized) return patch;
      const dx = (w - p.width) / 2;
      const dy = (h - p.height) / 2;
      const done = new Map<Cel, Cel>();
      return {
        ...patch,
        frames: p.frames.map((f) => {
          const cels: Record<string, Cel> = {};
          for (const [k, c] of Object.entries(f.cels)) {
            let n = done.get(c);
            if (!n) {
              if (c.kind === 'image') n = { ...c, t: { ...c.t, x: c.t.x + dx, y: c.t.y + dy } };
              else {
                const nc = createCanvas(w, h);
                ctx2d(nc).drawImage(c.canvas, dx, dy);
                n = { kind: 'raster', key: c.key, canvas: nc };
              }
              done.set(c, n);
            }
            cels[k] = n;
          }
          return { ...f, cels };
        }),
      };
    });
  },

  setRefVideo: (r) => set((s) => (s.project ? { project: { ...s.project, refVideo: r }, dirty: true } : {})),
  updateRefVideo: (patch) =>
    set((s) => (s.project?.refVideo ? { project: { ...s.project, refVideo: { ...s.project.refVideo, ...patch } }, dirty: true } : {})),
  extendToRefVideo: () => {
    const s = get();
    const p = s.project!;
    const r = p.refVideo;
    if (!r) return;
    const need = Math.ceil((r.duration - r.trim) * p.fps) + r.startFrame;
    if (need <= p.frames.length) {
      s.toast('이미 영상 길이만큼 프레임이 있어요');
      return;
    }
    const add = Array.from({ length: Math.min(3000, need - p.frames.length) }, () => ({ id: uid('f_'), cels: {} }));
    s.commit('영상 길이에 맞추기', (p) => ({ frames: [...p.frames, ...add] }));
    s.toast(`빈 프레임 ${add.length}개를 추가했어요`, 'success');
  },

  extendToAudio: () => {
    const s = get();
    const p = s.project!;
    const a = p.audio;
    if (!a) return;
    const need = Math.ceil((a.buffer.duration - a.trim) * p.fps) + a.startFrame;
    if (need <= p.frames.length) {
      s.toast('이미 음악 길이만큼 프레임이 있어요');
      return;
    }
    const add = Array.from({ length: Math.min(2000, need - p.frames.length) }, () => ({ id: uid('f_'), cels: {} }));
    s.commit('음악 길이에 맞추기', (p) => ({ frames: [...p.frames, ...add] }));
    s.toast(`빈 프레임 ${add.length}개를 추가했어요`, 'success');
  },
}));

/** 현재 선택된 레이어/셀 헬퍼 */
export function currentLayer(s: EditorState): Layer | undefined {
  return s.project?.layers.find((l) => l.id === s.layerId);
}
export function currentCel(s: EditorState): Cel | undefined {
  return s.project?.frames[s.frameIndex]?.cels[s.layerId];
}

/* ---------------------------------------------------------------- 환경 설정 저장 */

const PREF_KEYS = [
  'onion', 'shape', 'selShape', 'cameraView', 'grid', 'playSpeed', 'exposureMode', 'scrubSound', 'timelineCol', 'timelineH',
  'brush', 'eraser', 'fill', 'recentColors', 'loop',
] as const;
const PREF_STORAGE = 'frameflow-prefs';

try {
  const saved = JSON.parse(localStorage.getItem(PREF_STORAGE) || '{}') as Partial<EditorState>;
  const init = useEditor.getState();
  const patch: Record<string, unknown> = {};
  for (const k of PREF_KEYS) {
    const v = saved[k];
    if (v === undefined || v === null) continue;
    const def = init[k];
    // 객체 설정은 기본값과 합쳐서 새로 생긴 항목도 채운다
    patch[k] = typeof def === 'object' && !Array.isArray(def) ? { ...(def as object), ...(v as object) } : v;
  }
  useEditor.setState(patch as Partial<EditorState>);
} catch {
  /* 저장소 사용 불가 */
}

let prefTimer = 0;
useEditor.subscribe((s, prev) => {
  if (!PREF_KEYS.some((k) => s[k] !== prev[k])) return;
  clearTimeout(prefTimer);
  prefTimer = window.setTimeout(() => {
    try {
      const out: Record<string, unknown> = {};
      for (const k of PREF_KEYS) out[k] = useEditor.getState()[k];
      localStorage.setItem(PREF_STORAGE, JSON.stringify(out));
    } catch {
      /* noop */
    }
  }, 400);
});
