import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, FlipHorizontal2, FlipVertical2, RotateCcw, Crosshair, History } from 'lucide-react';
import { useEditor, currentCel, currentLayer, type BrushSettings } from '../store/editor';
import { Slider, Toggle } from './ui';
import { TOOLS } from './Toolbar';
import { nudge } from '../lib/nudge';
import { DEFAULT_T } from '../lib/render';

function BrushProps({ k }: { k: 'brush' | 'eraser' }) {
  const st = useEditor((s) => s[k]);
  const set = useEditor((s) => s.set);
  const up = (p: Partial<BrushSettings>) => set({ [k]: { ...st, ...p } } as never);
  return (
    <>
      <Slider label="크기" value={st.size} min={1} max={200} onChange={(size) => up({ size })} format={(v) => `${v}px`} />
      <Slider label="불투명도" value={Math.round(st.opacity * 100)} min={1} max={100} onChange={(v) => up({ opacity: v / 100 })} format={(v) => `${v}%`} />
      <Slider label="손떨림 보정" value={Math.round(st.smoothing * 100)} min={0} max={100} onChange={(v) => up({ smoothing: v / 100 })} format={(v) => `${v}`} />
      <Toggle label="펜 필압 사용" on={st.pressure} onChange={(pressure) => up({ pressure })} />
    </>
  );
}

function NudgePad() {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="label">미세 이동 (방향키 · Shift=10px)</span>
      <div className="row" style={{ gap: 2 }}>
        <button className="icon-btn sm" onClick={() => nudge(-1, 0)} title="왼쪽">
          <ArrowLeft size={13} />
        </button>
        <button className="icon-btn sm" onClick={() => nudge(0, -1)} title="위">
          <ArrowUp size={13} />
        </button>
        <button className="icon-btn sm" onClick={() => nudge(0, 1)} title="아래">
          <ArrowDown size={13} />
        </button>
        <button className="icon-btn sm" onClick={() => nudge(1, 0)} title="오른쪽">
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <div className="field" style={{ gap: 4 }}>
      <label>{label}</label>
      <div className="row" style={{ gap: 4 }}>
        <input className="input grow" type="number" step={step} value={Math.round(value * 100) / 100} onChange={(e) => onChange(Number(e.target.value))} />
        {suffix && <span className="muted" style={{ fontSize: 11 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function MoveProps() {
  const cel = useEditor(currentCel);
  const layer = useEditor(currentLayer);
  const p = useEditor((s) => s.project)!;
  const fi = useEditor((s) => s.frameIndex);
  const setT = useEditor((s) => s.setTransform);
  const copyPrev = useEditor((s) => s.copyTransformFromPrev);
  if (!layer || !cel) return <div className="muted">이 프레임의 선택한 레이어가 비어 있어요.</div>;
  if (cel.kind === 'raster')
    return (
      <>
        <div className="muted" style={{ lineHeight: 1.6 }}>
          그림을 드래그해서 옮기고, 모서리로 크기를, 위쪽 동그라미로 회전해요. <span className="kbd">Shift</span> 로 수평/수직·15° 고정.
        </div>
        <NudgePad />
      </>
    );
  const t = cel.t;
  const a = p.assets[cel.assetId];
  const set = (patch: Partial<typeof t>, key = 'num') => setT(fi, layer.id, patch, `${key}:${layer.id}:${fi}`);
  return (
    <>
      <div className="grid2" style={{ gap: 8 }}>
        <NumField label="X" value={t.x} onChange={(x) => set({ x })} />
        <NumField label="Y" value={t.y} onChange={(y) => set({ y })} />
        <NumField label="크기" value={t.scale * 100} onChange={(v) => set({ scale: Math.max(1, v) / 100 })} suffix="%" />
        <NumField label="회전" value={t.rotation} onChange={(rotation) => set({ rotation })} suffix="°" />
      </div>
      <Slider label="이 프레임 불투명도" value={Math.round(t.opacity * 100)} min={0} max={100} onChange={(v) => set({ opacity: v / 100 }, 'op')} format={(v) => `${v}%`} />
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => set({ flipX: !t.flipX }, 'flip')} title="좌우 반전">
          <FlipHorizontal2 size={13} /> 좌우
        </button>
        <button className="btn sm" onClick={() => set({ flipY: !t.flipY }, 'flip')} title="상하 반전">
          <FlipVertical2 size={13} /> 상하
        </button>
        <button className="btn sm" onClick={() => set({ x: p.width / 2, y: p.height / 2 }, 'center')} title="가운데로">
          <Crosshair size={13} /> 가운데
        </button>
        <button
          className="btn sm"
          onClick={() =>
            set({ ...DEFAULT_T, x: p.width / 2, y: p.height / 2, scale: a ? Math.min(1, (p.width * 0.9) / a.width, (p.height * 0.9) / a.height) : 1 }, 'reset')
          }
          title="변형 초기화"
        >
          <RotateCcw size={13} /> 초기화
        </button>
      </div>
      <button className="btn sm" onClick={copyPrev} disabled={fi === 0}>
        <History size={13} /> 이전 프레임 위치 그대로 가져오기
      </button>
      <NudgePad />
    </>
  );
}

export function ToolPanel() {
  const tool = useEditor((s) => s.tool);
  const fill = useEditor((s) => s.fill);
  const set = useEditor((s) => s.set);
  const info = TOOLS.find((t) => t.id === tool)!;
  return (
    <div className="panel">
      <div className="panel-head">
        <info.icon size={13} /> {info.label}
      </div>
      <div className="panel-body">
        {tool === 'brush' && <BrushProps k="brush" />}
        {tool === 'eraser' && <BrushProps k="eraser" />}
        {tool === 'fill' && (
          <>
            <Slider label="허용 오차" value={fill.tolerance} min={0} max={128} onChange={(tolerance) => set({ fill: { ...fill, tolerance } })} />
            <Toggle label="모든 레이어 참조 (선화 기준 채우기)" on={fill.allLayers} onChange={(allLayers) => set({ fill: { ...fill, allLayers } })} />
          </>
        )}
        {tool === 'move' && <MoveProps />}
        {tool === 'picker' && <div className="muted">캔버스를 눌러 색을 가져와요. 브러시 사용 중 <span className="kbd">Alt</span> 를 누르고 있어도 돼요.</div>}
        {tool === 'hand' && <div className="muted">드래그해서 화면을 옮겨요. 휠로 확대/축소, 두 손가락으로 핀치 줌.</div>}
      </div>
    </div>
  );
}
