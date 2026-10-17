import { useEffect, useState } from 'react';
import { Images, Film, Layers } from 'lucide-react';
import { Modal } from '../ui';
import { useEditor } from '../../store/editor';
import { importImageBlob, importImageSequence } from '../../lib/importers';

export function ImageImportDialog({ files, onClose }: { files: File[]; onClose: () => void }) {
  const fi = useEditor((s) => s.frameIndex);
  const n = useEditor((s) => s.project!.frames.length);
  const [urls, setUrls] = useState<string[]>([]);
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  useEffect(() => {
    const u = sorted.slice(0, 8).map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [files]);
  const extra = Math.max(0, fi + files.length - n);
  return (
    <Modal icon={<Images size={18} />} title={`이미지 ${files.length}장 가져오기`} sub="어떻게 넣을까요?" onClose={onClose}>
      <div className="row" style={{ gap: 6, overflow: 'hidden' }}>
        {urls.map((u, i) => (
          <img key={u} src={u} alt="" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line-2)' }} title={sorted[i].name} />
        ))}
        {files.length > 8 && <span className="muted">+{files.length - 8}</span>}
      </div>
      <div className="hero-actions" style={{ maxWidth: 'none' }}>
        <button
          className="action-card primary"
          onClick={() => {
            onClose();
            importImageSequence(files);
          }}
        >
          <div className="ic">
            <Film size={20} />
          </div>
          <div>
            <b>프레임 순서대로</b>
            <span>
              한 레이어에 1장씩 프레임 {fi + 1}~{fi + files.length}에 넣어요 (파일 이름 순)
              {extra > 0 && ` · 프레임 ${extra}개 추가`}
            </span>
          </div>
        </button>
        <button
          className="action-card"
          onClick={async () => {
            onClose();
            for (const f of sorted) await importImageBlob(f, f.name);
          }}
        >
          <div className="ic">
            <Layers size={20} />
          </div>
          <div>
            <b>각각 새 레이어로</b>
            <span>현재 프레임에 {files.length}개의 이미지 레이어를 만들어요</span>
          </div>
        </button>
      </div>
    </Modal>
  );
}
