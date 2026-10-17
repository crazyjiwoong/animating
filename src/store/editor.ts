import { create } from 'zustand';
import type { Asset, AudioTrack, Cel, Frame, Layer, LayerKind, Project, Tool, Transform } from '../types';
import { uid, clamp } from '../lib/id';
import { createCanvas, ctx2d } from '../lib/canvas';
import { DEFAULT_T, drawCel } from '../lib/render';
import type { NoteNaming } from '../lib/audio';

export const LAYER_COLORS = ['#8b7bff', '#ff6fb5', '#45b8ff', '#5ee38c', '#ffb340', '#ff5d73', '#3fd6c6', '#c06bff'];

type Snapshot = Pick<Project, 'layers' | 'frames' | 'width' | 'height' | 'background' | 'fps' | 'name'> & {
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
  | { type: 'settings' }
  | { type: 'export' }
  | { type: 'shortcuts' }
  | { type: 'audio' };

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
  onion: { enabled: boolean; before: number; after: number; opacity: number };
  playing: boolean;
  loop: boolean;
  scrubSound: boolean;
  noteNaming: NoteNaming;
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
  setTransform: (frameIndex: number, layerId: string, t: Partial<Transform>, key?: string) => void;
  copyCel: () => void;
  pasteCel: () => void;
  copyTransformFromPrev: () => void;

  /* ---- 에셋/오디오/설정 ---- */
  addAsset: (a: Asset) => void;
  importImage: (blob: Blob, name: string, bitmap: ImageBitmap) => void;
  setAudio: (a: AudioTrack | null) => void;
  updateAudio: (patch: Partial<AudioTrack>) => void;
  updateSettings: (patch: Partial<Pick<Project, 'name' | 'fps' | 'width' | 'height' | 'background'>>) => void;
  extendToAudio: () => void;
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
  // 셀은 불변이므로 얕은 복사로 충분 (이미지 변형만 별도 객체로)
  const cels: Record<string, Cel> = {};
  for (const [k, c] of Object.entries(f.cels)) cels[k] = c.kind === 'image' ? { ...c, t: { ...c.t } } : c;
  return { id: uid('f_'), cels, memo: f.memo };
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
  onion: { enabled: true, before: 1, after: 1, opacity: 0.35 },
  playing: false,
  loop: true,
  scrubSound: true,
  noteNaming: 'ko',
  timelineCol: 56,
  clipboard: null,
  toasts: [],
  rightPanelOpen: typeof window === 'undefined' || window.innerWidth > 1000,
  dialog: null,
  timelineH: 250,

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
    const cur: Snapshot = { ...snap, layers: p.layers, frames: p.frames, width: p.width, height: p.height, background: p.background, fps: p.fps, name: p.name, frameIndex: s.frameIndex, layerId: s.layerId };
    set({
      project: { ...p, layers: snap.layers, frames: snap.frames, width: snap.width, height: snap.height, background: snap.background, fps: snap.fps, name: snap.name },
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
    const cur: Snapshot = { ...snap, layers: p.layers, frames: p.frames, width: p.width, height: p.height, background: p.background, fps: p.fps, name: p.name, frameIndex: s.frameIndex, layerId: s.layerId, key: undefined };
    set({
      project: { ...p, layers: snap.layers, frames: snap.frames, width: snap.width, height: snap.height, background: snap.background, fps: snap.fps, name: snap.name },
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
    s.commit('레이어 복제', (p) => ({
      layers: [...p.layers.slice(0, idx + 1), copy, ...p.layers.slice(idx + 1)],
      frames: p.frames.map((f) => {
        const c = f.cels[id];
        if (!c) return f;
        return { ...f, cels: { ...f.cels, [copy.id]: c.kind === 'image' ? { ...c, t: { ...c.t } } : c } };
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
    s.commit('아래 레이어와 합치기', (p) => ({
      layers: p.layers.filter((l) => l.id !== upper.id).map((l) => (l.id === lower.id ? { ...l, kind: 'raster' as const } : l)),
      frames: p.frames.map((f) => {
        const a = f.cels[lower.id];
        const b = f.cels[upper.id];
        const cels = { ...f.cels };
        delete cels[upper.id];
        if (!a && !b) return { ...f, cels };
        const c = createCanvas(p.width, p.height);
        const ctx = ctx2d(c);
        if (a) drawCel(ctx, p, a);
        if (b && upper.visible) {
          ctx.globalAlpha = upper.opacity;
          ctx.globalCompositeOperation = upper.blend;
          drawCel(ctx, p, b);
        }
        cels[lower.id] = { kind: 'raster', canvas: c };
        return { ...f, cels };
      }),
    }));
    set({ layerId: lower.id });
  },

  rasterizeLayer: (id) => {
    const s = get();
    s.commit('래스터화', (p) => ({
      layers: p.layers.map((l) => (l.id === id ? { ...l, kind: 'raster' as const } : l)),
      frames: p.frames.map((f) => {
        const cel = f.cels[id];
        if (!cel || cel.kind === 'raster') return f;
        const c = createCanvas(p.width, p.height);
        drawCel(ctx2d(c), p, cel);
        return { ...f, cels: { ...f.cels, [id]: { kind: 'raster', canvas: c } } };
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
      (p) => ({
        frames: p.frames.map((f, i) => {
          if (i !== frameIndex) return f;
          const cels = { ...f.cels };
          if (cel) cels[layerId] = cel;
          else delete cels[layerId];
          return { ...f, cels };
        }),
      }),
      key ? { key } : undefined,
    );
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
    s.setCel(s.frameIndex, layer.id, cel, '셀 붙여넣기');
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
    const layer = makeLayer('image', name.replace(/\.[a-z0-9]+$/i, '').slice(0, 24) || '이미지', p.layers.length);
    const idx = p.layers.findIndex((l) => l.id === s.layerId);
    const at = idx < 0 ? p.layers.length : idx + 1;
    const t: Transform = { ...DEFAULT_T, x: p.width / 2, y: p.height / 2, scale: fit };
    s.commit('이미지 가져오기', (p) => ({
      layers: [...p.layers.slice(0, at), layer, ...p.layers.slice(at)],
      frames: p.frames.map((f, i) => (i === s.frameIndex ? { ...f, cels: { ...f.cels, [layer.id]: { kind: 'image', assetId: asset.id, t } } } : f)),
    }));
    set({ layerId: layer.id, tool: 'move' });
    s.toast('이미지를 새 레이어로 가져왔어요 · 이동 도구로 위치를 조절하세요', 'success');
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
      return {
        ...patch,
        frames: p.frames.map((f) => {
          const cels: Record<string, Cel> = {};
          for (const [k, c] of Object.entries(f.cels)) {
            if (c.kind === 'image') cels[k] = { ...c, t: { ...c.t, x: c.t.x + dx, y: c.t.y + dy } };
            else {
              const nc = createCanvas(w, h);
              ctx2d(nc).drawImage(c.canvas, dx, dy);
              cels[k] = { kind: 'raster', canvas: nc };
            }
          }
          return { ...f, cels };
        }),
      };
    });
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
