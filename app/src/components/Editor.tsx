import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editor';
import { useView } from '../store/view';
import { saveProject } from '../lib/storage';
import { desktop, isDesktop } from '../lib/platform';
import { playAudioFrom, playFrameSlice, stopAudio } from '../lib/audio';
import { importFiles, importImageBlob } from '../lib/importers';
import { nudge } from '../lib/nudge';
import { sel, cancelSelection, commitSelection, deleteSelection, nudgeSelection } from '../lib/selection';
import { TopBar } from './TopBar';
import { Toolbar } from './Toolbar';
import { Viewport } from './Viewport';
import { ColorPanel } from './ColorPanel';
import { ToolPanel } from './ToolPanel';
import { LayerPanel } from './LayerPanel';
import { Timeline } from './Timeline';
import { Toasts } from './ui';
import { FrameDialog } from './dialogs/FrameDialog';
import { SettingsDialog } from './dialogs/ProjectDialogs';
import { ExportDialog } from './dialogs/ExportDialog';
import { ShortcutsDialog } from './dialogs/ShortcutsDialog';
import { ImageImportDialog } from './dialogs/ImageImportDialog';
import type { Tool } from '../types';

const TOOL_KEYS: Record<string, Tool> = { b: 'brush', e: 'eraser', u: 'shape', v: 'move', c: 'camera', g: 'fill', i: 'picker', h: 'hand' };

function usePlayback() {
  const playing = useEditor((s) => s.playing);
  const playSpeed = useEditor((s) => s.playSpeed);
  useEffect(() => {
    if (!playing) {
      stopAudio();
      return;
    }
    const st = useEditor.getState();
    const p = st.project!;
    const n = p.frames.length;
    let from = st.frameIndex >= n - 1 ? 0 : st.frameIndex;
    let t0 = performance.now();
    const startAudio = () => {
      const s = useEditor.getState();
      const pr = s.project!;
      if (pr.audio) playAudioFrom(pr.audio, pr.fps, from, pr.frames.length, s.playSpeed);
    };
    startAudio();
    st.setFrame(from);
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const s = useEditor.getState();
      const pr = s.project!;
      const total = pr.frames.length;
      const f = from + Math.floor(((now - t0) / 1000) * pr.fps * s.playSpeed);
      if (f >= total) {
        if (s.loop && total > 1) {
          from = 0;
          t0 = now;
          startAudio();
          s.setFrame(0);
        } else {
          s.set({ playing: false });
          s.setFrame(total - 1);
        }
        return;
      }
      if (f !== s.frameIndex) s.setFrame(f);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stopAudio();
    };
  }, [playing, playSpeed]);
}

export function Editor({ onExit }: { onExit: () => void }) {
  const dialog = useEditor((s) => s.dialog);
  const rightOpen = useEditor((s) => s.rightPanelOpen);
  const tlH = useEditor((s) => s.timelineH);
  const set = useEditor((s) => s.set);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  usePlayback();

  const save = useCallback(async (silent = false) => {
    commitSelection();
    const s = useEditor.getState();
    if (!s.project || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const snapshot = s.project;
    try {
      const at = await saveProject(snapshot);
      if (useEditor.getState().project === snapshot) useEditor.getState().markSaved(at);
      else useEditor.setState({ savedAt: at });
      if (!silent) s.toast('브라우저에 저장했어요', 'success');
    } catch (e) {
      s.toast('저장 실패: ' + (e as Error).message, 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  // 자동 저장 (변경 후 20초마다)
  useEffect(() => {
    const id = setInterval(() => {
      const s = useEditor.getState();
      if (s.dirty && !s.playing) save(true);
    }, 20000);
    return () => clearInterval(id);
  }, [save]);

  // PC 앱: 창 제목 · 저장 안 된 변경 표시 · 닫을 때 저장
  useEffect(() => {
    const upd = () => {
      const s = useEditor.getState();
      if (!s.project) return;
      document.title = `${s.dirty ? '● ' : ''}${s.project.name} — AMG`;
      desktop?.setDirty(s.dirty);
    };
    upd();
    const un = useEditor.subscribe((s, prev) => (s.dirty !== prev.dirty || s.project?.name !== prev.project?.name) && upd());
    const off = desktop?.onSaveAndClose(async () => {
      await save(true);
      desktop?.closeNow();
    });
    return () => {
      un();
      off?.();
      document.title = 'AMG';
      desktop?.setDirty(false);
    };
  }, [save]);

  // 닫기 전 경고 (웹 전용 — PC 앱은 위에서 운영체제 대화상자로 묻는다)
  useEffect(() => {
    if (isDesktop) return;
    const h = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // 스크럽 사운드
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (s.frameIndex !== prev.frameIndex && !s.playing && s.scrubSound && s.project?.audio) {
          playFrameSlice(s.project.audio, s.project.fps, s.frameIndex);
        }
      }),
    [],
  );

  // 붙여넣기: 이미지면 새 이미지 레이어, 아니면 셀 붙여넣기
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imgs = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (imgs.length > 1) {
        e.preventDefault();
        importFiles(imgs.map((i) => i.getAsFile()!).filter(Boolean));
        return;
      }
      const img = imgs[0];
      if (img) {
        e.preventDefault();
        const f = img.getAsFile();
        if (f) importImageBlob(f, f.name && f.name !== 'image.png' ? f.name : '붙여넣은 이미지');
        return;
      }
      const s = useEditor.getState();
      if (s.clipboard) {
        e.preventDefault();
        s.pasteCel();
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      const s = useEditor.getState();
      if (s.dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      // 떠 있는 범위가 있으면 먼저 처리
      if (sel.floating) {
        if (e.key === 'Escape' || (mod && k === 'z')) {
          cancelSelection();
          e.preventDefault();
          return;
        }
        if (e.key === 'Enter') {
          commitSelection();
          e.preventDefault();
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          deleteSelection();
          e.preventDefault();
          return;
        }
        if (e.key.startsWith('Arrow')) {
          const step = e.shiftKey ? 10 : 1;
          nudgeSelection(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
          e.preventDefault();
          return;
        }
      }
      if (mod) {
        if (k === 'z' && !e.shiftKey) s.undo();
        else if ((k === 'z' && e.shiftKey) || k === 'y') s.redo();
        else if (k === 's') save();
        else if (k === 'e') s.set({ dialog: { type: 'export' } });
        else if (k === 'd') s.duplicateFrame(s.frameIndex, 1);
        else if (k === 'c') s.copyCel();
        else if (k === 'f' && e.shiftKey) s.addFrame();
        else if (k === 'n' && e.shiftKey) s.addLayer('raster');
        else if (k === '0') useView.getState().fit();
        else if (e.code === 'KeyG' && e.altKey) {
          const l = s.project?.layers.find((x) => x.id === s.layerId);
          if (l && s.project!.layers[0].id !== l.id) s.updateLayer(l.id, { clip: !l.clip });
        } else return;
        e.preventDefault();
        return;
      }
      if (e.altKey) return;
      if (TOOL_KEYS[k]) {
        s.set({ tool: TOOL_KEYS[k] });
        return;
      }
      switch (e.key) {
        case 'Enter':
          s.set({ playing: !s.playing });
          break;
        case ',':
          s.setFrame(s.frameIndex - 1);
          break;
        case '.':
          s.setFrame(s.frameIndex + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          const step = e.shiftKey ? 10 : 1;
          if (s.tool === 'move') {
            const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
            const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
            nudge(dx, dy);
          } else if (e.key === 'ArrowLeft') s.setFrame(s.frameIndex - 1);
          else if (e.key === 'ArrowRight') s.setFrame(s.frameIndex + 1);
          else return;
          break;
        }
        case 'Home':
          s.setFrame(0);
          break;
        case 'End':
          s.setFrame(s.project!.frames.length - 1);
          break;
        case 'Delete':
        case 'Backspace':
          if (s.project!.frames[s.frameIndex]?.cels[s.layerId]) s.setCel(s.frameIndex, s.layerId, null, '셀 지우기');
          break;
        case '[':
        case ']': {
          const key = s.tool === 'eraser' ? 'eraser' : 'brush';
          const b = s[key];
          const size = e.key === '[' ? Math.max(1, Math.round(b.size / 1.2)) : Math.min(200, Math.round(b.size * 1.2) + 1);
          s.set({ [key]: { ...b, size } } as never);
          break;
        }
        case 'm':
        case 'M':
          s.set({ flipView: !s.flipView });
          break;
        case "'":
          s.set({ grid: { ...s.grid, enabled: !s.grid.enabled } });
          break;
        case 'o':
        case 'O':
          s.set({ onion: { ...s.onion, enabled: !s.onion.enabled } });
          break;
        case '0':
          useView.getState().fit();
          break;
        case '+':
        case '=':
          useView.getState().zoomAt(1.25);
          break;
        case '-':
          useView.getState().zoomAt(1 / 1.25);
          break;
        case '?':
          s.set({ dialog: { type: 'shortcuts' } });
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const goHome = async () => {
    commitSelection();
    const s = useEditor.getState();
    s.set({ playing: false });
    if (s.dirty) await save(true);
    onExit();
  };

  const close = () => set({ dialog: null });
  return (
    <div className={'editor' + (rightOpen ? ' right-open' : ' no-right')} style={{ ['--tl-h' as string]: `${tlH}px` }}>
      <TopBar onSave={() => save()} onHome={goHome} saving={saving} />
      <Toolbar />
      <Viewport />
      <div className="right">
        {rightOpen && (
          <>
            <div className="right-top">
              <ColorPanel />
              <ToolPanel />
            </div>
            <LayerPanel />
          </>
        )}
      </div>
      <Timeline />
      {dialog?.type === 'frame' && <FrameDialog index={dialog.index} onClose={close} />}
      {dialog?.type === 'settings' && <SettingsDialog onClose={close} tab={dialog.tab} />}
      {dialog?.type === 'export' && <ExportDialog onClose={close} />}
      {dialog?.type === 'shortcuts' && <ShortcutsDialog onClose={close} />}
      {dialog?.type === 'imageImport' && <ImageImportDialog files={dialog.files} onClose={close} />}
      <Toasts />
    </div>
  );
}
