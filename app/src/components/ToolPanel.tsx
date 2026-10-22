import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, FlipHorizontal2, FlipVertical2, RotateCcw, Crosshair, History, ImageUp, Slash, Square, Circle, Lasso, Check, Trash2, Plus, Maximize } from 'lucide-react';
import { cameraAt, cameraKeysByIndex } from '../lib/motion';
import { cancelSelection, commitSelection, deleteSelection } from '../lib/selection';
import { openFiles } from '../lib/platform';
import { replaceCurrentImage } from '../lib/importers';
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

function ShapeProps() {
  const shape = useEditor((s) => s.shape);
  const brush = useEditor((s) => s.brush);
  const set = useEditor((s) => s.set);
  return (
    <>
      <div className="seg" style={{ alignSelf: 'stretch', display: 'flex' }}>
        {([
          ['line', <Slash size={14} key="l" />, '직선'],
          ['rect', <Square size={14} key="r" />, '사각형'],
          ['ellipse', <Circle size={14} key="e" />, '원'],
        ] as const).map(([k, icon, label]) => (
          <button key={k} className={shape.kind === k ? 'on' : ''} style={{ flex: 1, display: 'inline-flex', gap: 5, alignItems: 'center', justifyContent: 'center' }} onClick={() => set({ shape: { ...shape, kind: k } })}>
            {icon} {label}
          </button>
        ))}
      </div>
      {shape.kind !== 'line' && <Toggle label="안을 채우기" on={shape.fill} onChange={(fill) => set({ shape: { ...shape, fill } })} />}
      <Slider label="선 굵기" value={brush.size} min={1} max={200} onChange={(size) => set({ brush: { ...brush, size } })} format={(v) => `${v}px`} />
      <Slider label="불투명도" value={Math.round(brush.opacity * 100)} min={1} max={100} onChange={(v) => set({ brush: { ...brush, opacity: v / 100 } })} format={(v) => `${v}%`} />
      <div className="muted" style={{ fontSize: 11.5 }}>
        <span className="kbd">Shift</span> 정사각형 · 정원 · 45° 직선
      </div>
    </>
  );
}

function CameraProps() {
  const p = useEditor((s) => s.project)!;
  const fi = useEditor((s) => s.frameIndex);
  const cameraView = useEditor((s) => s.cameraView);
  const st = useEditor.getState();
  const cam = p.camera;
  const v = cameraAt(p, fi);
  const hasKey = !!cam?.keys.some((k) => k.frameId === p.frames[fi].id);
  const keyCount = cam ? cameraKeysByIndex(p).length : 0;
  const set = (patch: Parameters<typeof st.setCameraKey>[1], k = 'num') => st.setCameraKey(fi, patch, `cam-${k}:${fi}`);
  return (
    <>
      <Toggle label="카메라 사용 (내보내기·재생에 적용)" on={!!cam?.enabled} onChange={(enabled) => st.updateCamera({ enabled })} />
      <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
        캔버스의 주황색 틀이 영상에 보일 화면이에요. 틀을 끌어 옮기고, 모서리로 확대, 위 동그라미로 회전하면 이 프레임에 <b style={{ color: 'var(--text)' }}>키</b>가 생겨요. 키와 키 사이는 자동으로 이어져요.
      </div>
      <div className="grid2" style={{ gap: 8 }}>
        <NumField label="X" value={v.x} onChange={(x) => set({ x })} />
        <NumField label="Y" value={v.y} onChange={(y) => set({ y })} />
        <NumField label="확대" value={v.zoom * 100} onChange={(z) => set({ zoom: Math.max(5, z) / 100 })} suffix="%" />
        <NumField label="회전" value={v.rotation} onChange={(rotation) => set({ rotation })} suffix="°" />
      </div>
      <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {hasKey ? (
          <button className="btn sm danger" onClick={() => st.deleteCameraKey(fi)}>
            <Trash2 size={13} /> 이 프레임 키 삭제
          </button>
        ) : (
          <button className="btn sm primary" onClick={() => set({}, 'add')}>
            <Plus size={13} /> 이 프레임에 키 추가
          </button>
        )}
        <button className="btn sm" onClick={() => set({ x: p.width / 2, y: p.height / 2, zoom: 1, rotation: 0 }, 'home')} title="전체 화면이 보이게">
          <Maximize size={13} /> 전체 보기
        </button>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">키 사이 움직임</span>
        <div className="seg">
          <button className={(cam?.ease ?? 'smooth') === 'smooth' ? 'on' : ''} onClick={() => st.updateCamera({ ease: 'smooth' })}>부드럽게</button>
          <button className={cam?.ease === 'linear' ? 'on' : ''} onClick={() => st.updateCamera({ ease: 'linear' })}>일정하게</button>
        </div>
      </div>
      <Slider label="화면 흔들림" value={cam?.shake ?? 0} min={0} max={100} onChange={(shake) => st.updateCamera({ shake, enabled: true }, 'shake')} format={(x) => (x ? `${x}` : '없음')} />
      <Toggle label="재생할 때 카메라 화면으로 보기" on={cameraView} onChange={(cameraView) => st.set({ cameraView })} />
      <div className="muted" style={{ fontSize: 11.5 }}>키 {keyCount}개 · 타임라인 ‘카메라’ 줄의 ◆ 를 우클릭하면 지워요</div>
    </>
  );
}

function SelectProps() {
  const selShape = useEditor((s) => s.selShape);
  const active = useEditor((s) => s.selectionActive);
  const set = useEditor((s) => s.set);
  const direct = useEditor((s) => s.tool === 'select');
  const selMode = useEditor((s) => s.selMode);
  const areaOn = useEditor((s) => s.areaActive);
  return (
    <div className="sel-box">
      {direct && (
        <div className="seg" style={{ display: 'flex' }}>
          {([
            ['new', '새로'],
            ['add', '추가 (Shift)'],
            ['sub', '빼기 (Alt)'],
          ] as const).map(([k, label]) => (
            <button key={k} className={selMode === k ? 'on' : ''} style={{ flex: 1 }} onClick={() => set({ selMode: k })}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">{direct ? '끌어서 범위 지정' : '꾹 누르고 끌어서 범위 지정'}</span>
      </div>
      <div className="seg" style={{ display: 'flex' }}>
        {([
          ['lasso', <Lasso size={14} key="l" />, '올가미'],
          ['rect', <Square size={14} key="r" />, '사각형'],
          ['ellipse', <Circle size={14} key="e" />, '원'],
        ] as const).map(([k, icon, label]) => (
          <button key={k} className={selShape === k ? 'on' : ''} style={{ flex: 1, display: 'inline-flex', gap: 5, alignItems: 'center', justifyContent: 'center' }} onClick={() => set({ selShape: k })}>
            {icon} {label}
          </button>
        ))}
      </div>
      {active ? (
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm primary grow" onClick={commitSelection} title="Enter">
            <Check size={13} /> 확정
          </button>
          <button className="btn sm" onClick={cancelSelection} title="Esc">
            취소
          </button>
          <button className="btn sm danger" onClick={deleteSelection} title="Delete">
            <Trash2 size={13} /> 지우기
          </button>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          {direct
            ? areaOn
              ? '선택 영역 안에만 칠해지고 지워져요. 이동 도구로 끌면 영역 안 그림만 움직여요. 화면 위 메뉴에서 지우기·채우기·복사·변형. 빈 곳을 짧게 누르면 해제 (Ctrl+D).'
              : '끌어서 감싸면 선택 영역이 생겨요 (그림은 그대로). 그 안에만 칠하거나, 지우고, 옮길 수 있어요. 전체 선택 Ctrl+A.'
            : '잠깐 꾹 누른 채로 끌면 일부분만 골라 옮기거나 돌릴 수 있어요. 바로 끌면 레이어 전체가 움직여요.'}
        </div>
      )}
    </div>
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
      <button
        className="btn sm"
        onClick={async () => {
          const f = (await openFiles('image'))[0];
          if (f) replaceCurrentImage(f);
        }}
        title="위치·크기는 그대로 두고 이 프레임의 그림만 바꿔요"
      >
        <ImageUp size={13} /> 이 프레임 이미지 교체
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
        {tool === 'shape' && <ShapeProps />}
        {tool === 'fill' && (
          <>
            <Slider label="허용 오차" value={fill.tolerance} min={0} max={128} onChange={(tolerance) => set({ fill: { ...fill, tolerance } })} />
            <Toggle label="모든 레이어 참조 (선화 기준 채우기)" on={fill.allLayers} onChange={(allLayers) => set({ fill: { ...fill, allLayers } })} />
          </>
        )}
        {tool === 'camera' && <CameraProps />}
        {(tool === 'move' || tool === 'select') && <SelectProps />}
        {tool === 'move' && <MoveProps />}
        {tool === 'picker' && <div className="muted">캔버스를 눌러 색을 가져와요. 브러시 사용 중 <span className="kbd">Alt</span> 를 누르고 있어도 돼요.</div>}
        {tool === 'hand' && <div className="muted">드래그해서 화면을 옮겨요. 휠로 확대/축소, 두 손가락으로 핀치 줌.</div>}
      </div>
    </div>
  );
}
