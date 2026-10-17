/**
 * 한 포인터의 드래그를 끝까지 추적한다. 브라우저가 스크롤 등으로 포인터를 취소하면
 * onEnd(null) 이 불리고 리스너가 정리된다.
 */
export function trackPointer(
  e: { pointerId: number },
  onMove: (ev: PointerEvent) => void,
  onEnd?: (ev: PointerEvent | null) => void,
) {
  const id = e.pointerId;
  const move = (ev: PointerEvent) => ev.pointerId === id && onMove(ev);
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    cleanup();
    onEnd?.(ev);
  };
  const cancel = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    cleanup();
    onEnd?.(null);
  };
  function cleanup() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
