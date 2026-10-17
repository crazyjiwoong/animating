import { useEditor } from '../store/editor';
import { createCanvas, ctx2d } from './canvas';

/** 선택한 레이어의 현재 프레임 셀을 dx, dy 만큼 옮긴다 */
export function nudge(dx: number, dy: number) {
  const s = useEditor.getState();
  const p = s.project;
  if (!p) return;
  const layer = p.layers.find((l) => l.id === s.layerId);
  const cel = p.frames[s.frameIndex]?.cels[s.layerId];
  if (!layer || !cel) return;
  if (layer.locked) {
    s.toast('잠긴 레이어예요', 'error');
    return;
  }
  const key = `nudge:${layer.id}:${s.frameIndex}`;
  if (cel.kind === 'image') {
    s.setTransform(s.frameIndex, layer.id, { x: cel.t.x + dx, y: cel.t.y + dy }, key);
  } else {
    const c = createCanvas(p.width, p.height);
    ctx2d(c).drawImage(cel.canvas, dx, dy);
    s.setCel(s.frameIndex, layer.id, { kind: 'raster', canvas: c }, '미세 이동', key);
  }
}
