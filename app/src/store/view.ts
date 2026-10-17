import { create } from 'zustand';

interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  /** 화면 맞춤 요청 카운터 (값이 바뀌면 Viewport 가 맞춤 실행) */
  fitTick: number;
  stageW: number;
  stageH: number;
  setView: (v: Partial<Pick<ViewState, 'zoom' | 'panX' | 'panY' | 'stageW' | 'stageH'>>) => void;
  fit: () => void;
  zoomAt: (factor: number, sx?: number, sy?: number) => void;
}

export const useView = create<ViewState>((set, get) => ({
  zoom: 1,
  panX: 0,
  panY: 0,
  fitTick: 0,
  stageW: 0,
  stageH: 0,
  setView: (v) => set(v),
  fit: () => set((s) => ({ fitTick: s.fitTick + 1 })),
  zoomAt: (factor, sx, sy) => {
    const s = get();
    const x = sx ?? s.stageW / 2;
    const y = sy ?? s.stageH / 2;
    const zoom = Math.min(32, Math.max(0.05, s.zoom * factor));
    const k = zoom / s.zoom;
    set({ zoom, panX: x - (x - s.panX) * k, panY: y - (y - s.panY) * k });
  },
}));
