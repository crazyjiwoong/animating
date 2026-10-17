import { useState } from 'react';
import { Sparkles, Settings, Ghost } from 'lucide-react';
import { Modal, Seg, Slider, Toggle } from '../ui';
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

function ViewSettings() {
  const onion = useEditor((s) => s.onion);
  const grid = useEditor((s) => s.grid);
  const flipView = useEditor((s) => s.flipView);
  const exposureMode = useEditor((s) => s.exposureMode);
  const scrub = useEditor((s) => s.scrubSound);
  const naming = useEditor((s) => s.noteNaming);
  const set = useEditor((s) => s.set);
  const o = (patch: Partial<typeof onion>) => set({ onion: { ...onion, ...patch } });
  return (
    <>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row">
          <Ghost size={16} color="var(--accent)" />
          <b className="grow">이전 프레임 겹쳐 보기 (어니언 스킨)</b>
          <button type="button" className={'toggle' + (onion.enabled ? ' on' : '')} onClick={() => o({ enabled: !onion.enabled })} aria-pressed={onion.enabled} />
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: -6 }}>
          현재 프레임 위에 이전 프레임이 반투명하게 보여요. 움직임 간격을 맞출 때 좋아요. 재생 중에는 자동으로 숨겨요.
        </div>
        <div style={{ opacity: onion.enabled ? 1 : 0.4, pointerEvents: onion.enabled ? 'auto' : 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Slider label="불투명도" value={Math.round(onion.opacity * 100)} min={5} max={90} onChange={(v) => o({ opacity: v / 100 })} format={(v) => `${v}%`} />
          <div className="grid2">
            <Slider label="이전 프레임" value={onion.before} min={0} max={5} onChange={(before) => o({ before })} format={(v) => `${v}장`} />
            <Slider label="다음 프레임" value={onion.after} min={0} max={5} onChange={(after) => o({ after })} format={(v) => `${v}장`} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">표시 방식</span>
            <Seg value={onion.mode} onChange={(mode) => o({ mode })} options={[{ value: 'plain', label: '원래 색' }, { value: 'tint', label: '색 입히기 (이전 빨강 · 다음 파랑)' }]} />
          </div>
          <Toggle label="길게 늘린 같은 그림은 건너뛰고 이전 '다른' 그림 보기" on={onion.skipSame} onChange={(skipSame) => o({ skipSame })} />
        </div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <b>타임라인</b>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">셀 끝을 끌어 늘릴 때</span>
          <Seg value={exposureMode} onChange={(exposureMode) => set({ exposureMode })} options={[{ value: 'ripple', label: '뒤 그림 밀기' }, { value: 'overwrite', label: '덮어쓰기' }]} />
        </div>
        <Toggle label="프레임 이동할 때 소리 듣기 (스크럽)" on={scrub} onChange={(scrubSound) => set({ scrubSound })} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">음 이름</span>
          <Seg value={naming} onChange={(noteNaming) => set({ noteNaming })} options={[{ value: 'ko', label: '도레미' }, { value: 'en', label: 'CDE' }]} />
        </div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <b>캔버스 보기</b>
        <Toggle label="격자 표시 ( ' )" on={grid.enabled} onChange={(enabled) => set({ grid: { ...grid, enabled } })} />
        {grid.enabled && <Slider label="격자 간격" value={grid.size} min={8} max={256} step={8} onChange={(size) => set({ grid: { ...grid, size } })} format={(v) => `${v}px`} />}
        <Toggle label="안전 영역 표시 (가장자리 5% · 10%)" on={grid.safe} onChange={(safe) => set({ grid: { ...grid, safe } })} />
        <Toggle label="좌우 반전 보기 (M) — 그림 비율 확인용" on={flipView} onChange={(flipView) => set({ flipView })} />
      </div>
    </>
  );
}

export function SettingsDialog({ onClose, tab: initialTab }: { onClose: () => void; tab?: 'project' | 'view' }) {
  const p = useEditor((s) => s.project)!;
  const update = useEditor((s) => s.updateSettings);
  const [tab, setTab] = useState<'project' | 'view'>(initialTab ?? 'project');
  const [form, setForm] = useState<ProjectForm>({ name: p.name, width: p.width, height: p.height, fps: p.fps, background: p.background });
  return (
    <Modal
      wide
      icon={<Settings size={18} />}
      title="설정"
      sub={`${p.frames.length}프레임 · ${(p.frames.length / form.fps).toFixed(2)}초 (현재 ${form.fps}fps 기준)`}
      onClose={onClose}
      footer={
        tab === 'project' ? (
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
        ) : (
          <button className="btn primary" onClick={onClose}>
            완료
          </button>
        )
      }
    >
      <Seg value={tab} onChange={setTab} options={[{ value: 'project', label: '작품 (크기 · FPS)' }, { value: 'view', label: '보기 (겹쳐 보기 · 격자)' }]} />
      {tab === 'project' ? <FormBody form={form} setForm={setForm} lockSize /> : <ViewSettings />}
    </Modal>
  );
}
