import type { LayerOverride } from './render';

/** 히스토리에 들어가지 않는 일시적인 화면 상태 (그리는 중인 획, 변형 미리보기 등) */
type Listener = () => void;
const listeners = new Set<Listener>();

export const live: {
  override: LayerOverride | null;
  cursor: { x: number; y: number; r: number } | null;
} = { override: null, cursor: null };

export function invalidate() {
  listeners.forEach((l) => l());
}
export function onInvalidate(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
