import { useMemo, useRef, useState } from 'react';
import { Download, Film, Music } from 'lucide-react';
import { Modal, Seg, Stepper, Toggle } from '../ui';
import { useEditor } from '../../store/editor';
import { exportFramePng, exportGif, exportVideo, supportedVideoFormats } from '../../lib/export';
import { exportProjectFile } from '../../lib/storage';
import { downloadBlob, safeFileName } from '../../lib/id';
import { stopAudio } from '../../lib/audio';

type Kind = string; // 비디오 포맷 id | 'gif' | 'png' | 'project'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const p = useEditor((s) => s.project)!;
  const fi = useEditor((s) => s.frameIndex);
  const toast = useEditor((s) => s.toast);
  const formats = useMemo(supportedVideoFormats, []);
  const [kind, setKind] = useState<Kind>(formats[0]?.id ?? 'gif');
  const [scale, setScale] = useState(1);
  const [loops, setLoops] = useState(1);
  const [withAudio, setWithAudio] = useState(true);
  const [transparentPng, setTransparentPng] = useState(p.background === null);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bg = p.background ?? '#ffffff';
  const name = safeFileName(p.name);
  const seconds = (p.frames.length * loops) / p.fps;
  const video = formats.find((f) => f.id === kind);

  const run = async () => {
    useEditor.getState().set({ playing: false });
    stopAudio();
    abort.current = new AbortController();
    setProgress(0);
    try {
      if (video) {
        const blob = await exportVideo(p, video, { scale, loops, withAudio, background: bg, onProgress: setProgress, signal: abort.current.signal });
        downloadBlob(blob, `${name}.${video.ext}`);
      } else if (kind === 'gif') {
        const blob = await exportGif(p, { scale, loops, background: bg, onProgress: setProgress, signal: abort.current.signal });
        downloadBlob(blob, `${name}.gif`);
      } else if (kind === 'png') {
        downloadBlob(await exportFramePng(p, fi, scale, transparentPng), `${name}_${String(fi + 1).padStart(3, '0')}.png`);
      } else if (kind === 'project') {
        downloadBlob(await exportProjectFile(p), `${name}.ffanim`);
      }
      toast('내보내기 완료!', 'success');
      onClose();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('내보내기에 실패했어요: ' + (e as Error).message, 'error');
      setProgress(null);
    }
  };

  const opts: { id: Kind; label: string; desc: string }[] = [
    ...formats.map((f) => ({ id: f.id, label: f.label, desc: f.ext === 'mp4' ? '어디서나 재생 · 음악 포함' : '웹·유튜브 업로드 · 음악 포함' })),
    { id: 'gif', label: 'GIF', desc: '움짤 · 소리 없음' },
    { id: 'png', label: 'PNG', desc: `현재 프레임 (${fi + 1}) 이미지` },
    { id: 'project', label: '프로젝트 파일', desc: '.ffanim · 나중에 불러오기' },
  ];

  return (
    <Modal
      icon={<Download size={18} />}
      title="내보내기"
      sub={`${p.frames.length}프레임 · ${p.fps}fps · ${p.width}×${p.height}`}
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      footer={
        <>
          <button className="btn ghost" onClick={() => (progress !== null ? abort.current?.abort() : onClose())}>
            {progress !== null ? '취소' : '닫기'}
          </button>
          <button className="btn primary" onClick={run} disabled={progress !== null}>
            <Download size={15} /> {progress !== null ? '만드는 중…' : '내보내기'}
          </button>
        </>
      }
    >
      <div className="format-grid">
        {opts.map((o) => (
          <button key={o.id} className={'format-opt' + (kind === o.id ? ' on' : '')} onClick={() => setKind(o.id)}>
            <b>{o.label}</b>
            <span>{o.desc}</span>
          </button>
        ))}
      </div>
      {formats.length === 0 && <div className="muted">이 브라우저는 동영상 녹화를 지원하지 않아요. GIF 로 내보내거나 Chrome/Edge 를 사용해 주세요.</div>}

      {kind !== 'project' && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">해상도</span>
          <Seg
            value={scale}
            onChange={setScale}
            options={[
              { value: 0.5, label: `0.5× (${Math.round(p.width / 2)}px)` },
              { value: 1, label: `1× (${p.width}px)` },
              { value: 2, label: `2× (${p.width * 2}px)` },
            ]}
          />
        </div>
      )}
      {(video || kind === 'gif') && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">{video ? '반복 횟수' : '반복'}</span>
          {video ? (
            <div className="row">
              <Stepper value={loops} onChange={setLoops} min={1} max={20} />
              <span className="muted">번 · {seconds.toFixed(1)}초</span>
            </div>
          ) : (
            <Seg value={loops > 0 ? 1 : 0} onChange={(v) => setLoops(v)} options={[{ value: 1, label: '무한 반복' }, { value: 0, label: '한 번' }]} />
          )}
        </div>
      )}
      {video && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row">
            <Music size={15} color="var(--accent)" />
            <span className="grow">{p.audio ? p.audio.name : '음악 없음 · 타임라인에서 음악을 추가할 수 있어요'}</span>
          </div>
          {p.audio && <Toggle label="영상에 음악 넣기" on={withAudio} onChange={setWithAudio} />}
          <div className="muted" style={{ fontSize: 11.5 }}>
            <Film size={11} /> 동영상은 실제 재생 속도로 녹화돼요 (약 {seconds.toFixed(1)}초). 녹화 중에는 이 탭을 열어 두세요.
          </div>
        </div>
      )}
      {kind === 'png' && <Toggle label="투명 배경으로 저장" on={transparentPng} onChange={setTransparentPng} />}
      {progress !== null && (
        <div className="field">
          <label>진행 중… {Math.round(progress * 100)}%</label>
          <div className="progress">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
    </Modal>
  );
}
