import { Brush, Eraser, Move, PaintBucket, Pipette, Hand, Undo2, Redo2, ImagePlus } from 'lucide-react';
import type { Tool } from '../types';
import { useEditor } from '../store/editor';
import { pickFile } from '../lib/id';
import { importFiles } from '../lib/importers';

export const TOOLS: { id: Tool; icon: typeof Brush; label: string; key: string }[] = [
  { id: 'brush', icon: Brush, label: '브러시', key: 'B' },
  { id: 'eraser', icon: Eraser, label: '지우개', key: 'E' },
  { id: 'move', icon: Move, label: '이동 · 변형', key: 'V' },
  { id: 'fill', icon: PaintBucket, label: '채우기', key: 'G' },
  { id: 'picker', icon: Pipette, label: '스포이드', key: 'I' },
  { id: 'hand', icon: Hand, label: '손 (스페이스)', key: 'H' },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const set = useEditor((s) => s.set);
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  return (
    <div className="tools">
      {TOOLS.map((t) => (
        <button key={t.id} className={'tool-btn' + (tool === t.id ? ' active' : '')} onClick={() => set({ tool: t.id })} aria-label={t.label}>
          <t.icon size={18} />
          <span className="tip">
            {t.label} <span className="kbd">{t.key}</span>
          </span>
        </button>
      ))}
      <div className="sep" />
      <button className="tool-btn" onClick={async () => importFiles(await pickFile('image/*', true))} aria-label="이미지 가져오기">
        <ImagePlus size={18} />
        <span className="tip">
          이미지 가져오기 <span className="kbd">Ctrl V</span>
        </span>
      </button>
      <div className="sep" />
      <button className="tool-btn" onClick={undo} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.35 }} aria-label="실행 취소">
        <Undo2 size={18} />
        <span className="tip">
          실행 취소 <span className="kbd">Ctrl Z</span>
        </span>
      </button>
      <button className="tool-btn" onClick={redo} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.35 }} aria-label="다시 실행">
        <Redo2 size={18} />
        <span className="tip">
          다시 실행 <span className="kbd">Ctrl Shift Z</span>
        </span>
      </button>
      <div className="color-chip" style={{ background: color, marginBottom: 6 }} title="현재 색">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value, false)} onBlur={(e) => setColor(e.target.value)} />
      </div>
    </div>
  );
}
