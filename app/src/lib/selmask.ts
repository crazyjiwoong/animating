import { useEditor, makeLayer } from '../store/editor';
import { alphaBounds, cloneCanvas, createCanvas, ctx2d } from './canvas';
import { invalidate } from './live';
import { uid } from './id';
import { makeSelection, type Pt } from './selection';

/*
 * 선택 영역 (클립 스튜디오 올가미처럼). 그림을 떼어 내지 않고 '영역'만 기억한다.
 * 영역이 있으면 브러시·지우개·채우기·도형이 그 안에만 칠해지고,
 * 지우기·채우기·복사·잘라내기·변형을 영역에 대해 할 수 있다.
 * 레이어·프레임을 바꿔도 영역은 그대로 남는다.
 */

export type AreaOp = 'new' | 'add' | 'sub';

interface Area {
  /** 선택된 곳 = 불투명 (프로젝트 크기) */
  mask: HTMLCanvasElement;
  /** 개미 줄로 보여 줄 테두리들 */
  outlines: Pt[][];
  /** 반전했으면 캔버스 테두리도 개미 줄로 */
  inverted: boolean;
  /** 선택된 곳의 범위 (메뉴 위치용) */
  bounds: { x: number; y: number; w: number; h: number };
}

export const area: { cur: Area | null } = { cur: null };

function publish() {
  const on = !!area.cur;
  if (useEditor.getState().areaActive !== on) useEditor.setState({ areaActive: on });
  invalidate();
}

function polyPath(c: CanvasRenderingContext2D, pts: Pt[]) {
  c.beginPath();
  pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
  c.closePath();
}



/** 테두리 모양으로 영역을 새로 만들거나 더하거나 뺀다 */
export function setArea(outline: Pt[], op: AreaOp) {
  const p = useEditor.getState().project;
  if (!p || outline.length < 3) return;
  const prev = area.cur;
  if (op === 'sub' && !prev) return;
  const mask = op === 'new' || !prev ? createCanvas(p.width, p.height) : cloneCanvas(prev.mask);
  const m = ctx2d(mask);
  m.globalCompositeOperation = op === 'sub' ? 'destination-out' : 'source-over';
  m.fillStyle = '#000';
  polyPath(m, outline);
  m.fill();
  const bounds = alphaBounds(mask);
  if (!bounds) {
    clearArea();
    return;
  }
  const keep = op === 'new' || !prev ? [] : prev.outlines;
  area.cur = { mask, outlines: [...keep, outline], inverted: op === 'new' || !prev ? false : prev.inverted, bounds };
  publish();
}

export function clearArea() {
  if (!area.cur) return;
  area.cur = null;
  publish();
}

export function selectAll() {
  const p = useEditor.getState().project;
  if (!p) return;
  const r = [
    { x: 0, y: 0 },
    { x: p.width, y: 0 },
    { x: p.width, y: p.height },
    { x: 0, y: p.height },
  ];
  setArea(r, 'new');
}

export function invertArea() {
  const p = useEditor.getState().project;
  if (!p || !area.cur) return;
  const mask = createCanvas(p.width, p.height);
  const m = ctx2d(mask);
  m.fillStyle = '#000';
  m.fillRect(0, 0, p.width, p.height);
  m.globalCompositeOperation = 'destination-out';
  m.drawImage(area.cur.mask, 0, 0);
  const bounds = alphaBounds(mask);
  if (!bounds) {
    clearArea();
    return;
  }
  area.cur = { mask, outlines: area.cur.outlines, inverted: !area.cur.inverted, bounds };
  publish();
}

/** 개미 줄로 그릴 테두리들 (캔버스 좌표) */
export function areaOutlines(): Pt[][] {
  const a = area.cur;
  if (!a) return [];
  const p = useEditor.getState().project!;
  if (!a.inverted) return a.outlines;
  return [
    ...a.outlines,
    [
      { x: 0, y: 0 },
      { x: p.width, y: 0 },
      { x: p.width, y: p.height },
      { x: 0, y: p.height },
    ],
  ];
}

/** 영역이 있으면 src 를 영역 안쪽만 남긴 캔버스로 (src 는 건드리지 않음). 영역이 없으면 src 그대로 */
const tmp: { c: HTMLCanvasElement | null } = { c: null };
export function maskToArea(src: HTMLCanvasElement): HTMLCanvasElement {
  const a = area.cur;
  if (!a || a.mask.width !== src.width || a.mask.height !== src.height) return src;
  if (!tmp.c || tmp.c.width !== src.width || tmp.c.height !== src.height) tmp.c = createCanvas(src.width, src.height);
  const t = ctx2d(tmp.c);
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, src.width, src.height);
  t.drawImage(src, 0, 0);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(a.mask, 0, 0);
  t.globalCompositeOperation = 'source-over';
  return tmp.c;
}

/** 지금 레이어·프레임의 그림 (래스터만) */
function target() {
  const s = useEditor.getState();
  const p = s.project!;
  const layer = p.layers.find((l) => l.id === s.layerId);
  const cel = p.frames[s.frameIndex]?.cels[s.layerId];
  if (!layer) return null;
  if (layer.locked) {
    s.toast('잠긴 레이어예요', 'error');
    return null;
  }
  if (layer.kind !== 'raster') {
    s.toast('그림(래스터) 레이어에서 쓸 수 있어요', 'error');
    return null;
  }
  return { s, p, layer, base: cel?.kind === 'raster' ? cel.canvas : null };
}

/** 영역 안 지우기 */
export function eraseArea() {
  const a = area.cur;
  const t = a && target();
  if (!a || !t || !t.base) return;
  const out = cloneCanvas(t.base);
  const c = ctx2d(out);
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(a.mask, 0, 0);
  t.s.setCel(t.s.frameIndex, t.layer.id, { kind: 'raster', canvas: out }, '선택 영역 지우기');
}

/** 영역을 지금 색으로 채우기 */
export function fillArea() {
  const a = area.cur;
  const t = a && target();
  if (!a || !t) return;
  const paint = createCanvas(t.p.width, t.p.height);
  const pc = ctx2d(paint);
  pc.drawImage(a.mask, 0, 0);
  pc.globalCompositeOperation = 'source-in';
  pc.fillStyle = t.s.color;
  pc.fillRect(0, 0, t.p.width, t.p.height);
  const out = t.base ? cloneCanvas(t.base) : createCanvas(t.p.width, t.p.height);
  const c = ctx2d(out);
  if (t.layer.alphaLock) c.globalCompositeOperation = 'source-atop';
  c.drawImage(paint, 0, 0);
  t.s.setCel(t.s.frameIndex, t.layer.id, { kind: 'raster', canvas: out }, '선택 영역 채우기');
}

/** 영역 안 그림을 새 레이어로 (cut 이면 원래 자리는 지움) */
export function areaToNewLayer(cut: boolean) {
  const a = area.cur;
  const t = a && target();
  if (!a || !t) return;
  if (!t.base) {
    t.s.toast('이 프레임의 이 레이어에 그림이 없어요', 'error');
    return;
  }
  const piece = cloneCanvas(t.base);
  const pc = ctx2d(piece);
  pc.globalCompositeOperation = 'destination-in';
  pc.drawImage(a.mask, 0, 0);
  if (!alphaBounds(piece)) {
    t.s.toast('선택 영역 안에 그림이 없어요', 'error');
    return;
  }
  let rest: HTMLCanvasElement | null = null;
  if (cut) {
    rest = cloneCanvas(t.base);
    const rc = ctx2d(rest);
    rc.globalCompositeOperation = 'destination-out';
    rc.drawImage(a.mask, 0, 0);
  }
  const s = t.s;
  const fi = s.frameIndex;
  const src = t.layer;
  const layer = makeLayer('raster', `${src.name} (${cut ? '잘라냄' : '복사'})`, t.p.layers.length);
  // 길게 늘린 그림(홀드)은 같은 셀을 공유하므로 그 구간 전체에 적용
  const orig = t.p.frames[fi].cels[src.id];
  const pieceCel = { kind: 'raster' as const, key: uid('c_'), canvas: piece };
  const restCel = rest ? { kind: 'raster' as const, key: uid('c_'), canvas: rest } : null;
  s.commit(cut ? '잘라서 새 레이어' : '복사해서 새 레이어', (p) => {
    const at = p.layers.findIndex((l) => l.id === src.id) + 1;
    return {
      layers: [...p.layers.slice(0, at), layer, ...p.layers.slice(at)],
      frames: p.frames.map((f, i) => {
        if (i !== fi && f.cels[src.id] !== orig) return f;
        const cels = { ...f.cels, [layer.id]: pieceCel };
        if (restCel) cels[src.id] = restCel;
        return { ...f, cels };
      }),
    };
  });
  useEditor.setState({ layerId: layer.id });
  s.toast(cut ? '잘라서 새 레이어로 옮겼어요' : '복사해서 새 레이어로 만들었어요', 'success');
}

/** 영역 안 그림을 떼어서 변형(이동·크기·회전) 시작. 성공하면 true */
export function transformArea(): boolean {
  const a = area.cur;
  const t = a && target();
  if (!a || !t) return false;
  if (!t.base) {
    t.s.toast('이 프레임의 이 레이어에 그림이 없어요', 'error');
    return false;
  }
  const f = makeSelection(t.layer.id, t.s.frameIndex, areaOutlines(), a.mask);
  if (!f) {
    t.s.toast('선택 영역 안에 그림이 없어요', 'error');
    return false;
  }
  // 떼어 낸 뒤에는 떠 있는 그림의 테두리가 영역을 대신한다
  clearArea();
  return true;
}

// 작품을 바꾸거나 캔버스 크기가 바뀌면 영역을 지운다
useEditor.subscribe((s, prev) => {
  if (!area.cur) return;
  const p = s.project;
  if (!p || p.id !== prev.project?.id || p.width !== area.cur.mask.width || p.height !== area.cur.mask.height) clearArea();
});
