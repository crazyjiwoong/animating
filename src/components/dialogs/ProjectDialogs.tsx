import { useState } from 'react';
import { Sparkles, Settings } from 'lucide-react';
import { Modal } from '../ui';
import { FpsPicker } from '../FpsPicker';
import { useEditor } from '../../store/editor';
import { clamp } from '../../lib/id';

export const SIZE_PRESETS = [
  { name: 'HD', w: 1280, h: 720, note: '16:9' },
  { name: 'Full HD', w: 1920, h: 1080, note: '16:9' },
  { name: '정사각', w: 1080, h: 1080, note: '1:1 · 인스타' },
  { name: '세로', w: 1080, h: 1920, note: '9:16 · 쇼츠' },
  { name: '4:3', w: 1024, h: 768, note: '클래식' },
  { name: '작은 HD', w: 640, h: 360, note: '가벼운 작업' },
  { name: '움짤', w: 480, h: 480, note: 'GIF 용' },
  { name: '세로 4:5', w: 1080, h: 1350, note: '피드' },
];

const BG = [null, '#ffffff', '#f6f1e7', '#fde8ef', '#e7f0ff', '#1d1f2b', '#000000'];

export interface ProjectForm {
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string | null;
}

function FormBody({ form, setForm, lockSize }: { form: ProjectForm; setForm: (f: ProjectForm) => void; lockSize?: boolean }) {
  const up = (p: Partial<ProjectForm>) => setForm({ ...form, ...p });
  return (
    <>
      <div className="field">
        <label>작품 이름</label>
        <input className="input" value={form.name} onChange={(e) => up({ name: e.target.value })} placeholder="제목 없는 애니메이션" autoFocus />
      </div>
      <div className="field">
        <label>캔버스 크기 {lockSize && <span className="muted">· 바꾸면 그림은 가운데를 기준으로 유지돼요</span>}</label>
        <div className="size-grid">
          {SIZE_PRESETS.map((s) => {
            const on = s.w === form.width && s.h === form.height;
            const k = 22 / Math.max(s.w, s.h);
            return (
              <button key={s.name} className={'size-opt' + (on ? ' on' : '')} onClick={() => up({ width: s.w, height: s.h })}>
                <span className="shape" style={{ width: s.w * k, height: s.h * k }} />
                <span>
                  <b>{s.name}</b>
                  <span>
                    {s.w}×{s.h} · {s.note}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>직접 입력</span>
          <input
            className="input"
            style={{ width: 90 }}
            type="number"
            value={form.width}
            onChange={(e) => up({ width: clamp(Math.round(Number(e.target.value) || 1), 16, 4096) })}
          />
          <span className="muted">×</span>
          <input
            className="input"
            style={{ width: 90 }}
            type="number"
            value={form.height}
            onChange={(e) => up({ height: clamp(Math.round(Number(e.target.value) || 1), 16, 4096) })}
          />
          <span className="muted">px</span>
        </div>
      </div>
      <FpsPicker value={form.fps} onChange={(fps) => up({ fps })} />
      <div className="field">
        <label>배경</label>
        <div className="bg-opts">
          {BG.map((c) => (
            <button
              key={String(c)}
              title={c ?? '투명'}
              className={(c === null ? 'transparent ' : '') + (form.background === c ? 'on' : '')}
              style={c ? { background: c } : undefined}
              onClick={() => up({ background: c })}
            />
          ))}
          <input
            type="color"
            value={form.background ?? '#ffffff'}
            onChange={(e) => up({ background: e.target.value })}
            style={{ width: 30, height: 30, border: 0, padding: 0, background: 'none' }}
            title="직접 고르기"
          />
          <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>
            {form.background === null ? '투명 (영상 추출 시 흰색)' : form.background}
          </span>
        </div>
      </div>
    </>
  );
}

export function NewProjectDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (f: ProjectForm) => void }) {
  const [form, setForm] = useState<ProjectForm>({ name: '', width: 1280, height: 720, fps: 12, background: '#ffffff' });
  return (
    <Modal
      wide
      icon={<Sparkles size={18} />}
      title="새 애니메이션"
      sub="크기와 프레임 속도는 나중에 설정에서 바꿀 수 있어요"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={() => onCreate({ ...form, name: form.name.trim() || '제목 없는 애니메이션' })}>
            만들기
          </button>
        </>
      }
    >
      <FormBody form={form} setForm={setForm} />
    </Modal>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const p = useEditor((s) => s.project)!;
  const update = useEditor((s) => s.updateSettings);
  const [form, setForm] = useState<ProjectForm>({ name: p.name, width: p.width, height: p.height, fps: p.fps, background: p.background });
  return (
    <Modal
      wide
      icon={<Settings size={18} />}
      title="작품 설정"
      sub={`${p.frames.length}프레임 · ${(p.frames.length / form.fps).toFixed(2)}초 (현재 ${form.fps}fps 기준)`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            취소
          </button>
          <button
            className="btn primary"
            onClick={() => {
              update({ ...form, name: form.name.trim() || p.name });
              onClose();
            }}
          >
            적용
          </button>
        </>
      }
    >
      <FormBody form={form} setForm={setForm} lockSize />
    </Modal>
  );
}
