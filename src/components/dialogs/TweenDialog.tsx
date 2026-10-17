import { useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { Modal, Seg, Stepper } from '../ui';
import { useEditor, EASINGS, type Easing } from '../../store/editor';

const EASE_OPTS: { value: Easing; label: string }[] = [
  { value: 'linear', label: '일정하게' },
  { value: 'in', label: '천천히 시작' },
  { value: 'out', label: '천천히 멈춤' },
  { value: 'inout', label: '부드럽게' },
];

export function TweenDialog({ onClose }: { onClose: () => void }) {
  const p = useEditor((s) => s.project)!;
  const fi = useEditor((s) => s.frameIndex);
  const layerId = useEditor((s) => s.layerId);
  const layer = p.layers.find((l) => l.id === layerId);
  const st = useEditor.getState();

  // 현재 프레임이 속한 '이미지가 연속으로 있는 구간'을 기본값으로
  const [defFrom, defTo] = useMemo(() => {
    const has = (i: number) => p.frames[i]?.cels[layerId]?.kind === 'image';
    let a = fi,
      b = fi;
    while (a > 0 && has(a - 1)) a--;
    while (b < p.frames.length - 1 && has(b + 1)) b++;
    return fi > a ? [a, fi] : [fi, b];
  }, []);
  const [from, setFrom] = useState(defFrom + 1);
  const [to, setTo] = useState(defTo + 1);
  const [easing, setEasing] = useState<Easing>('inout');
  const [extra, setExtra] = useState(0);

  const A = p.frames[from - 1]?.cels[layerId];
  const B = p.frames[to - 1]?.cels[layerId];
  const ok = layer?.kind === 'image' && A?.kind === 'image' && B?.kind === 'image' && to - from + extra >= 2;
  const steps = to - from + extra;

  // 움직임 미리보기
  const W = 320,
    H = 180;
  const k = Math.min(W / p.width, H / p.height);
  const pts =
    A?.kind === 'image' && B?.kind === 'image'
      ? Array.from({ length: steps + 1 }, (_, i) => {
          const e = EASINGS[easing](i / Math.max(1, steps));
          return [(A.t.x + (B.t.x - A.t.x) * e) * k, (A.t.y + (B.t.y - A.t.y) * e) * k];
        })
      : [];

  return (
    <Modal
      icon={<Wand2 size={18} />}
      title="자동 중간 프레임 (트윈)"
      sub={layer ? `'${layer.name}' 레이어 · 시작과 끝 그림의 위치·크기·회전·투명도 사이를 채워요` : ''}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            취소
          </button>
          <button
            className="btn primary"
            disabled={!ok}
            onClick={() => {
              if (extra > 0) st.duplicateFrame(from - 1, extra);
              useEditor.getState().tween(layerId, from - 1, to - 1 + extra, easing);
              onClose();
            }}
          >
            <Wand2 size={15} /> 채우기
          </button>
        </>
      }
    >
      {layer?.kind !== 'image' ? (
        <div className="muted">이미지 레이어를 선택해 주세요. 트윈은 가져온 이미지의 위치·크기·회전을 보간해요.</div>
      ) : (
        <>
          <div className="grid2">
            <div className="field">
              <label>시작 프레임</label>
              <Stepper value={from} min={1} max={p.frames.length} onChange={setFrom} />
            </div>
            <div className="field">
              <label>끝 프레임</label>
              <Stepper value={to} min={1} max={p.frames.length} onChange={setTo} />
            </div>
          </div>
          <div className="field">
            <label>움직임 속도 (이징)</label>
            <Seg value={easing} onChange={setEasing} options={EASE_OPTS} />
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="label">사이에 프레임 더 넣기</span>
            <Stepper value={extra} min={0} max={120} onChange={setExtra} />
            <span className="muted" style={{ fontSize: 12 }}>시작 그림을 복제해서 넣고 채워요</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', background: '#0f1117', borderRadius: 12, border: '1px solid var(--line-2)' }}>
            <rect x={0} y={0} width={p.width * k} height={p.height * k} fill="#fff" opacity={0.04} />
            {pts.length > 1 && <polyline points={pts.map((q) => q.join(',')).join(' ')} fill="none" stroke="#8b7bff" strokeOpacity={0.4} strokeDasharray="4 4" />}
            {pts.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={i === 0 || i === pts.length - 1 ? 6 : 3.5} fill={i === 0 ? '#5ee38c' : i === pts.length - 1 ? '#ff6fb5' : '#8b7bff'} />
            ))}
          </svg>
          <div className="muted" style={{ fontSize: 12 }}>
            {!A || A.kind !== 'image' ? `프레임 ${from}에 이 레이어의 이미지가 없어요. ` : ''}
            {!B || B.kind !== 'image' ? `프레임 ${to}에 이 레이어의 이미지가 없어요. ` : ''}
            {ok ? `중간 ${steps - 1}장을 자동으로 만들어요 (점 간격 = 프레임마다 움직이는 거리)` : to - from + extra < 2 ? '시작과 끝 사이에 1장 이상 필요해요 · “프레임 더 넣기”를 늘려 보세요' : ''}
          </div>
        </>
      )}
    </Modal>
  );
}
