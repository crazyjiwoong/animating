import { create } from 'zustand';
import { useEditor } from './editor';

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  /** 화면 회전 (도). 그림은 그대로이고 보는 각도만 바뀐다 */
  rotation: number;
  /** 화면 맞춤 요청 카운터 (값이 바뀌면 Viewport 가 맞춤 실행) */
  fitTick: number;
  stageW: number;
  stageH: number;
  setView: (v: Partial<Pick<ViewState, 'zoom' | 'panX' | 'panY' | 'stageW' | 'stageH' | 'rotation'>>) => void;
  fit: () => void;
  zoomAt: (factor: number, sx?: number, sy?: number) => void;
  /** 화면 가운데를 기준으로 회전 */
  setRotation: (deg: number, sx?: number, sy?: number) => void;
}

function flipInfo() {
  const s = useEditor.getState();
  return { flip: s.flipView, w: s.project?.width ?? 0 };
}

/** 캔버스 좌표 → 화면 좌표 변환 행렬 (CSS 픽셀) */
export function viewMatrix(v: Pick<ViewState, 'panX' | 'panY' | 'zoom' | 'rotation'> = useView.getState()): DOMMatrix {
  const { flip, w } = flipInfo();
  let m = new DOMMatrix().translate(v.panX, v.panY).rotate(v.rotation).scale(v.zoom);
  if (flip) m = m.translate(w, 0).scale(-1, 1);
  return m;
}

export function toScreenPt(x: number, y: number): [number, number] {
  const p = viewMatrix().transformPoint({ x, y });
  return [p.x, p.y];
}

export function toCanvasPt(sx: number, sy: number): { x: number; y: number } {
  const p = viewMatrix().inverse().transformPoint({ x: sx, y: sy });
  return { x: p.x, y: p.y };
}

/** 캔버스 점 (cx, cy) 가 화면 (sx, sy) 에 오도록 하는 pan 값 */
export function panFor(sx: number, sy: number, cx: number, cy: number, zoom: number, rotation: number) {
  const q = viewMatrix({ panX: 0, panY: 0, zoom, rotation }).transformPoint({ x: cx, y: cy });
  return { panX: sx - q.x, panY: sy - q.y };
}

const norm = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

export const useView = create<ViewState>((set, get) => ({
  zoom: 1,
  panX: 0,
  panY: 0,
  rotation: 0,
  fitTick: 0,
  stageW: 0,
  stageH: 0,
  setView: (v) => set(v),
  fit: () => set((s) => ({ fitTick: s.fitTick + 1 })),
  zoomAt: (factor, sx, sy) => {
    const s = get();
    const x = sx ?? s.stageW / 2;
    const y = sy ?? s.stageH / 2;
    const c = toCanvasPt(x, y);
    const zoom = Math.min(32, Math.max(0.05, s.zoom * factor));
    set({ zoom, ...panFor(x, y, c.x, c.y, zoom, s.rotation) });
  },
  setRotation: (deg, sx, sy) => {
    const s = get();
    const x = sx ?? s.stageW / 2;
    const y = sy ?? s.stageH / 2;
    const c = toCanvasPt(x, y);
    const rotation = norm(deg);
    set({ rotation, ...panFor(x, y, c.x, c.y, s.zoom, rotation) });
  },
}));
