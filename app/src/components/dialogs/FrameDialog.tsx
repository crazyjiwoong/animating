import { useEffect, useRef, useState } from 'react';
import { CopyPlus, Film, ArrowLeft, ArrowRight, Eraser, Trash2, SquarePlus, MoveHorizontal } from 'lucide-react';
import { Modal, Stepper } from '../ui';
import { useEditor, runAt } from '../../store/editor';
import { renderThumb } from '../../lib/render';
import { formatTime } from '../../lib/audio';

export function FrameDialog({ index, onClose }: { index: number; onClose: () => void }) {
  const p = useEditor((s) => s.project)!;
  const st = useEditor.getState();
  const [count, setCount] = useState(3);
  const [empty, setEmpty] = useState(1);
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = p.frames[index];
  const [memo, setMemo] = useState(frame?.memo ?? '');
  const layerId = useEditor((s) => s.layerId);
  const layer = p.layers.find((l) => l.id === layerId);
  const [runA, runB] = frame ? runAt(p.frames, layerId, index) : [index, index];
  const hasCel = !!frame?.cels[layerId];
  const [hold, setHold] = useState(runB - runA + 1);

  useEffect(() => {
    if (ref.current && frame) renderThumb(p, index, 360, 240, ref.current);
  }, [p, index, frame]);

  if (!frame) return null;
  const celCount = Object.keys(frame.cels).filter((k) => p.layers.some((l) => l.id === k)).length;
  const after = p.frames.length - index - 1;

  return (
    <Modal
      icon={<Film size={18} />}
      title={`프레임 ${index + 1} 설정`}
      sub={`${formatTime(index / p.fps)} 지점 · 전체 ${p.frames.length}프레임`}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          닫기
        </button>
      }
    >
      <div className="frame-preview">
        <canvas ref={ref} />
        <div className="stat">
          <div>
            레이어 <b>{celCount}</b>개에 그림이 있어요
          </div>
          <div>
            표시 시간 <b>{(1000 / p.fps).toFixed(1)}ms</b> ({p.fps}fps)
          </div>
          <input className="input" placeholder="메모 (예: 입 벌림, 발 착지)" value={memo} onChange={(e) => setMemo(e.target.value)} onBlur={() => memo !== (frame.memo ?? '') && st.setMemo(index, memo)} />
        </div>
      </div>

      <div className="dup-box">
        <div className="row">
          <CopyPlus size={16} color="#c9c1ff" />
          <h4 className="grow">같은 그림 추가하기</h4>
        </div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          이 프레임의 레이어 구성을 그대로 복제해서 바로 뒤에 넣어요. 복제된 프레임에서 그림을 조금씩 옮기며 움직임을 만들 수 있어요.
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span>같은 그림</span>
          <Stepper value={count} onChange={setCount} min={1} max={240} />
          <span>개 추가하기</span>
          <span className="grow" />
          <button
            className="btn primary"
            onClick={() => {
              st.duplicateFrame(index, count);
              onClose();
            }}
          >
            <CopyPlus size={15} /> {count}개 추가
          </button>
        </div>
        <div className="chips">
          {[1, 2, 3, 5, 8, 12, p.fps].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
            <button key={v} className="chip" onClick={() => setCount(v)}>
              {v}개{v === p.fps ? ' (1초)' : ''}
            </button>
          ))}
        </div>
        <div className="mini-strip" aria-hidden>
          {Array.from({ length: Math.min(index, 2) }, (_, i) => <span key={'b' + i} />)}
          <span className="src" />
          {Array.from({ length: Math.min(count, 18) }, (_, i) => <span key={'n' + i} className="new" />)}
          {count > 18 && <em className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>+{count - 18}</em>}
          {Array.from({ length: Math.min(after, 3) }, (_, i) => <span key={'a' + i} />)}
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          추가 후 {p.frames.length + count}프레임 · {((p.frames.length + count) / p.fps).toFixed(2)}초
        </div>
      </div>

      {layer && hasCel && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row">
            <MoveHorizontal size={16} color="var(--accent)" />
            <b className="grow">'{layer.name}' 그림 길이</b>
            <span className="muted" style={{ fontSize: 12 }}>
              지금 프레임 {runA + 1}~{runB + 1} ({runB - runA + 1}프레임)
            </span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Stepper value={hold} onChange={setHold} min={1} max={2000} />
            <span>프레임 동안 보이기</span>
            <span className="grow" />
            <button className="btn" onClick={() => { st.setExposure(layerId, runA, runB, hold); onClose(); }} disabled={hold === runB - runA + 1}>
              적용
            </button>
            <button className="btn" onClick={() => { st.setExposure(layerId, runA, runB, p.frames.length - runA, 'overwrite'); onClose(); }}>
              끝까지
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>타임라인에서 막대 오른쪽 끝을 끌어도 돼요. 늘린 구간은 한 그림이라 함께 편집돼요.</div>
        </div>
      )}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="label">빈 프레임</span>
        <Stepper value={empty} onChange={setEmpty} min={1} max={240} />
        <button
          className="btn"
          onClick={() => {
            st.insertEmptyFrames(index, empty);
            onClose();
          }}
        >
          <SquarePlus size={15} /> 뒤에 빈 프레임 {empty}개 넣기
        </button>
      </div>

      <div className="action-list">
        <button className="btn" disabled={index === 0} onClick={() => { st.moveFrame(index, index - 1); onClose(); }}>
          <ArrowLeft size={15} /> 앞으로 이동
        </button>
        <button className="btn" disabled={index >= p.frames.length - 1} onClick={() => { st.moveFrame(index, index + 1); onClose(); }}>
          <ArrowRight size={15} /> 뒤로 이동
        </button>
        <button className="btn" onClick={() => { st.clearFrame(index); onClose(); }}>
          <Eraser size={15} /> 프레임 비우기
        </button>
        <button className="btn danger" onClick={() => { st.deleteFrame(index); onClose(); }}>
          <Trash2 size={15} /> 프레임 삭제
        </button>
      </div>
    </Modal>
  );
}
