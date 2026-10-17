import { useEffect, useRef, useState } from 'react';
import {
  Home, Save, Download, Settings, ChevronDown, FileDown, ImagePlus, Music, ClipboardPaste, Undo2, Redo2, Copy, Eraser, Keyboard,
  PanelRight, CopyPlus, Plus, Trash2, Film,
} from 'lucide-react';
import { useEditor } from '../store/editor';
import { downloadBlob, pickFile, safeFileName } from '../lib/id';
import { importFiles, pasteFromSystemClipboard } from '../lib/importers';
import { exportProjectFile } from '../lib/storage';

function Menu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={'btn sm ghost' + (open ? ' on' : '')} onClick={() => setOpen(!open)}>
        {label} <ChevronDown size={12} style={{ opacity: 0.5 }} />
      </button>
      {open && <div className="dropdown">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function timeLabel(t: number | null) {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TopBar({ onSave, onHome, saving }: { onSave: () => void; onHome: () => void; saving: boolean }) {
  const p = useEditor((s) => s.project)!;
  const dirty = useEditor((s) => s.dirty);
  const savedAt = useEditor((s) => s.savedAt);
  const rightOpen = useEditor((s) => s.rightPanelOpen);
  const st = useEditor.getState();
  const [name, setName] = useState(p.name);
  useEffect(() => setName(p.name), [p.name]);

  return (
    <div className="topbar">
      <button className="icon-btn" onClick={onHome} title="홈으로">
        <Home size={16} />
      </button>
      <div className="brand-mark" style={{ width: 24, height: 24, borderRadius: 7 }}>
        <Film size={13} color="#fff" />
      </div>
      <div className="title">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== p.name && st.commit('이름 변경', () => ({ name: name.trim() }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
        />
      </div>
      <div className={'save-state hide-sm' + (dirty ? ' dirty' : '')}>
        <i />
        {saving ? '저장 중…' : dirty ? '저장되지 않은 변경' : savedAt ? `${timeLabel(savedAt)} 저장됨` : '새 작품'}
      </div>
      <div className="divider" />
      <Menu label="파일">
        {(close) => (
          <>
            <button onClick={() => { close(); onSave(); }}>
              <Save size={15} /> 저장 <span className="kbd">Ctrl S</span>
            </button>
            <button
              onClick={async () => {
                close();
                downloadBlob(await exportProjectFile(useEditor.getState().project!), `${safeFileName(p.name)}.ffanim`);
              }}
            >
              <FileDown size={15} /> 프로젝트 파일로 저장 (.ffanim)
            </button>
            <hr />
            <button onClick={async () => { close(); importFiles(await pickFile('image/*', true)); }}>
              <ImagePlus size={15} /> 이미지 가져오기
            </button>
            <button
              onClick={async () => {
                close();
                if (!(await pasteFromSystemClipboard())) st.toast('클립보드에 이미지가 없어요 · Ctrl+V 로 붙여넣어 보세요');
              }}
            >
              <ClipboardPaste size={15} /> 클립보드 이미지 붙여넣기 <span className="kbd">Ctrl V</span>
            </button>
            <button onClick={async () => { close(); importFiles(await pickFile('audio/*')); }}>
              <Music size={15} /> 음악 가져오기
            </button>
            <hr />
            <button onClick={() => { close(); st.set({ dialog: { type: 'export' } }); }}>
              <Download size={15} /> 내보내기 (동영상 · GIF) <span className="kbd">Ctrl E</span>
            </button>
          </>
        )}
      </Menu>
      <Menu label="편집">
        {(close) => (
          <>
            <button onClick={() => { close(); st.undo(); }}>
              <Undo2 size={15} /> 실행 취소 <span className="kbd">Ctrl Z</span>
            </button>
            <button onClick={() => { close(); st.redo(); }}>
              <Redo2 size={15} /> 다시 실행 <span className="kbd">Ctrl ⇧ Z</span>
            </button>
            <hr />
            <button onClick={() => { close(); st.copyCel(); }}>
              <Copy size={15} /> 셀 복사 <span className="kbd">Ctrl C</span>
            </button>
            <button onClick={() => { close(); st.pasteCel(); }}>
              <ClipboardPaste size={15} /> 셀 붙여넣기
            </button>
            <button
              onClick={() => {
                close();
                const s = useEditor.getState();
                s.setCel(s.frameIndex, s.layerId, null, '셀 지우기');
              }}
            >
              <Eraser size={15} /> 셀 지우기 <span className="kbd">Delete</span>
            </button>
          </>
        )}
      </Menu>
      <Menu label="프레임">
        {(close) => (
          <>
            <button onClick={() => { close(); st.addFrame(); }}>
              <Plus size={15} /> 빈 프레임 추가 <span className="kbd">Ctrl ⇧ F</span>
            </button>
            <button onClick={() => { close(); st.duplicateFrame(useEditor.getState().frameIndex, 1); }}>
              <CopyPlus size={15} /> 현재 프레임 복제 <span className="kbd">Ctrl D</span>
            </button>
            <button onClick={() => { close(); st.set({ dialog: { type: 'frame', index: useEditor.getState().frameIndex } }); }}>
              <CopyPlus size={15} /> 같은 그림 여러 개 추가…
            </button>
            <hr />
            <button onClick={() => { close(); st.deleteFrame(useEditor.getState().frameIndex); }}>
              <Trash2 size={15} /> 현재 프레임 삭제
            </button>
          </>
        )}
      </Menu>
      <span className="grow" />
      <button className="icon-btn hide-sm" onClick={() => st.set({ dialog: { type: 'shortcuts' } })} title="단축키">
        <Keyboard size={16} />
      </button>
      <button className="btn sm" onClick={() => st.set({ dialog: { type: 'settings' } })} title="작품 설정 (크기 · 프레임 속도)">
        <Settings size={14} /> <span className="hide-sm">설정 · {p.fps}fps</span>
      </button>
      <button className="btn sm" onClick={onSave} disabled={saving}>
        <Save size={14} /> <span className="hide-sm">저장</span>
      </button>
      <button className="btn sm primary" onClick={() => st.set({ dialog: { type: 'export' } })}>
        <Download size={14} /> 내보내기
      </button>
      <button className={'icon-btn' + (rightOpen ? ' active' : '')} onClick={() => st.set({ rightPanelOpen: !rightOpen })} title="패널 열기/닫기">
        <PanelRight size={16} />
      </button>
    </div>
  );
}
