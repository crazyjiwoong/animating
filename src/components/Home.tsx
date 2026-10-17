import { useEffect, useMemo, useState } from 'react';
import { Plus, FolderOpen, Trash2, PenLine, Layers, Music, Film, Copy, Clapperboard } from 'lucide-react';
import type { ProjectMeta } from '../types';
import { deleteProject, importProjectFile, listProjects, loadProject, renameProject } from '../lib/storage';
import { makeProject, useEditor } from '../store/editor';
import { NewProjectDialog } from './dialogs/ProjectDialogs';
import { FpsDemo } from './FpsPicker';
import { pickFile } from '../lib/id';
import { Toasts } from './ui';

function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return new Date(t).toLocaleDateString('ko-KR');
}

function Thumb({ blob }: { blob?: Blob }) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return <div className="thumb">{url ? <img src={url} alt="" /> : <Clapperboard size={28} color="#3a4152" />}</div>;
}

export function Home() {
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const openProject = useEditor((s) => s.openProject);
  const toast = useEditor((s) => s.toast);

  const refresh = () => listProjects().then(setList).catch(() => setList([]));
  useEffect(() => {
    refresh();
  }, []);

  const openFile = async (file?: File) => {
    const f = file ?? (await pickFile('.ffanim,application/octet-stream'))[0];
    if (!f) return;
    setBusy(true);
    try {
      openProject(await importProjectFile(f));
    } catch (e) {
      toast((e as Error).message || '파일을 열 수 없어요', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openSaved = async (id: string) => {
    setBusy(true);
    try {
      const p = await loadProject(id);
      if (p) openProject(p);
      else toast('프로젝트를 찾을 수 없어요', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="home"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) openFile(f);
      }}
    >
      <div className="home-inner">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="brand">
            <div className="brand-mark">
              <Layers size={16} color="#fff" />
            </div>
            FrameFlow
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            브라우저에 자동 저장 · 설치 필요 없음
          </span>
        </div>

        <section className="hero">
          <div>
            <h1>
              한 장 한 장 그려서
              <br />
              <em>움직이게</em> 만드세요
            </h1>
            <p>
              그림을 붙여넣고, 프레임을 복제하고, 조금씩 옮기면 애니메이션이 완성돼요. 음악을 넣으면 프레임마다 어떤 음이 나오는지도
              보여드려요.
            </p>
            <div className="hero-actions">
              <button className="action-card primary" onClick={() => setShowNew(true)}>
                <div className="ic">
                  <Plus size={20} />
                </div>
                <div>
                  <b>새로 만들기</b>
                  <span>크기 · 프레임 속도 선택</span>
                </div>
              </button>
              <button className="action-card" onClick={() => openFile()} disabled={busy}>
                <div className="ic">
                  <FolderOpen size={20} />
                </div>
                <div>
                  <b>불러오기</b>
                  <span>.ffanim 프로젝트 파일 열기</span>
                </div>
              </button>
            </div>
          </div>
          <div className="hero-visual">
            <div className="fps-preview" style={{ display: 'block', height: '100%' }}>
              <FpsDemo fps={12} fill />
            </div>
          </div>
        </section>

        <div className="section-head">
          <h3>최근 작품</h3>
          {list && list.length > 0 && <span className="muted">{list.length}개</span>}
        </div>
        {list === null ? (
          <div className="empty">불러오는 중…</div>
        ) : list.length === 0 ? (
          <div className="empty">
            아직 저장된 작품이 없어요. <b style={{ color: 'var(--text)' }}>새로 만들기</b>로 첫 애니메이션을 시작해 보세요.
          </div>
        ) : (
          <div className="proj-grid">
            {list.map((m) => (
              <div key={m.id} className="proj" onClick={() => openSaved(m.id)}>
                <Thumb blob={m.thumb} />
                <div className="meta">
                  <b>{m.name}</b>
                  <span>
                    {m.frameCount}프레임 · {m.fps}fps · {m.width}×{m.height} · {timeAgo(m.updatedAt)}
                  </span>
                </div>
                <div className="menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn sm"
                    title="이름 바꾸기"
                    onClick={async () => {
                      const n = prompt('새 이름', m.name);
                      if (n && n.trim()) {
                        await renameProject(m.id, n.trim());
                        refresh();
                      }
                    }}
                  >
                    <PenLine size={13} />
                  </button>
                  <button
                    className="icon-btn sm"
                    title="삭제"
                    onClick={async () => {
                      if (confirm(`'${m.name}'을(를) 삭제할까요? 되돌릴 수 없어요.`)) {
                        await deleteProject(m.id);
                        refresh();
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="features">
          <div className="feature">
            <Layers className="ic" size={20} />
            <b>레이어 × 프레임</b>
            <span>클립 스튜디오처럼 레이어별 셀을 프레임마다 관리. 투명도 · 합성 모드 · 잠금.</span>
          </div>
          <div className="feature">
            <Copy className="ic" size={20} />
            <b>같은 그림 N개 추가</b>
            <span>프레임을 두 번 눌러 원하는 만큼 복제하고, 조금씩 옮기며 움직임을 만드세요.</span>
          </div>
          <div className="feature">
            <Music className="ic" size={20} />
            <b>프레임별 음 분석</b>
            <span>음악을 넣으면 파형과 함께 각 프레임의 주요 음(도레미)과 음량을 보여줘요.</span>
          </div>
          <div className="feature">
            <Film className="ic" size={20} />
            <b>영상 추출</b>
            <span>음악까지 포함해 MP4/WebM 동영상, GIF, PNG로 내보내기.</span>
          </div>
        </div>
      </div>
      {showNew && (
        <NewProjectDialog
          onClose={() => setShowNew(false)}
          onCreate={(f) => {
            setShowNew(false);
            openProject(makeProject(f));
          }}
        />
      )}
      {busy && (
        <div className="modal-back">
          <div className="toast">
            <span className="dot" />
            불러오는 중…
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
