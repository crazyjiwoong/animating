import { useMemo, useRef, useState } from 'react';
import { Download, Film, Music, CheckCircle2, FolderOpen } from 'lucide-react';
import { Modal, Seg, Stepper, Toggle } from '../ui';
import { useEditor } from '../../store/editor';
import { exportFramePng, exportGif, exportPngSequence, exportSpriteSheet, exportVideo, exportVideoNative, supportedVideoFormats } from '../../lib/export';
import { exportProjectFile } from '../../lib/storage';
import { safeFileName } from '../../lib/id';
import { stopAudio } from '../../lib/audio';
import { baseName, chooseSavePath, desktop, fileFilter, isDesktop, saveBlob } from '../../lib/platform';

interface Opt {
  id: string;
  label: string;
  desc: string;
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const p = useEditor((s) => s.project)!;
  const fi = useEditor((s) => s.frameIndex);
  const toast = useEditor((s) => s.toast);
  // 웹은 브라우저 녹화(MediaRecorder), PC 앱은 ffmpeg 로 정확하게 인코딩
  const webFormats = useMemo(() => (isDesktop ? [] : supportedVideoFormats()), []);
  const [kind, setKind] = useState<string>(isDesktop ? 'mp4' : webFormats[0]?.id ?? 'gif');
  const [scale, setScale] = useState(1);
  const [loops, setLoops] = useState(1);
  const [withAudio, setWithAudio] = useState(true);
  const [transparentPng, setTransparentPng] = useState(p.background === null);
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bg = p.background ?? '#ffffff';
  const name = safeFileName(p.name);
  const seconds = (p.frames.length * loops) / p.fps;
  const webVideo = webFormats.find((f) => f.id === kind);
  const isVideo = kind === 'mp4' || kind === 'webm' || !!webVideo;

  const finish = (path: string | null) => {
    setProgress(null);
    if (!path) return;
    if (isDesktop) setDone(path);
    else {
      toast('내보내기 완료!', 'success');
      onClose();
    }
  };

  const run = async () => {
    useEditor.getState().set({ playing: false });
    stopAudio();
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      if (isDesktop && (kind === 'mp4' || kind === 'webm')) {
        const path = await chooseSavePath(`${name}.${kind}`, fileFilter(kind === 'mp4' ? 'MP4 동영상' : 'WebM 동영상', kind), 'videos');
        if (!path) return;
        setProgress(0);
        await exportVideoNative(p, kind, path, { scale, loops, withAudio, background: bg, onProgress: setProgress, signal });
        finish(path);
      } else if (webVideo) {
        setProgress(0);
        const blob = await exportVideo(p, webVideo, { scale, loops, withAudio, background: bg, onProgress: setProgress, signal });
        finish(await saveBlob(blob, `${name}.${webVideo.ext}`, fileFilter('동영상', webVideo.ext), 'videos'));
      } else if (kind === 'gif') {
        setProgress(0);
        const blob = await exportGif(p, { scale, loops, background: bg, onProgress: setProgress, signal });
        finish(await saveBlob(blob, `${name}.gif`, fileFilter('GIF', 'gif'), 'pictures'));
      } else if (kind === 'png') {
        finish(await saveBlob(await exportFramePng(p, fi, scale, transparentPng), `${name}_${String(fi + 1).padStart(3, '0')}.png`, fileFilter('PNG', 'png'), 'pictures'));
      } else if (kind === 'sheet') {
        finish(await saveBlob(await exportSpriteSheet(p, scale, transparentPng), `${name}_sheet.png`, fileFilter('PNG', 'png'), 'pictures'));
      } else if (kind === 'pngseq') {
        setProgress(0);
        const blob = await exportPngSequence(p, scale, transparentPng, name, setProgress);
        finish(await saveBlob(blob, `${name}_frames.zip`, fileFilter('ZIP', 'zip'), 'pictures'));
      } else if (kind === 'project') {
        finish(await saveBlob(await exportProjectFile(p), `${name}.ffanim`, fileFilter('FrameFlow 프로젝트', 'ffanim')));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('내보내기에 실패했어요: ' + (e as Error).message, 'error');
      setProgress(null);
    }
  };

  const opts: Opt[] = [
    ...(isDesktop
      ? [
          { id: 'mp4', label: 'MP4 (H.264)', desc: '어디서나 재생 · 음악 포함' },
          { id: 'webm', label: 'WebM (VP9)', desc: '웹·유튜브 업로드 · 음악 포함' },
        ]
      : webFormats.map((f) => ({ id: f.id, label: f.label, desc: f.ext === 'mp4' ? '어디서나 재생 · 음악 포함' : '웹·유튜브 업로드 · 음악 포함' }))),
    { id: 'gif', label: 'GIF', desc: '움짤 · 소리 없음' },
    { id: 'png', label: 'PNG', desc: `현재 프레임 (${fi + 1}) 이미지` },
    { id: 'pngseq', label: 'PNG 묶음', desc: `${p.frames.length}장 · zip` },
    { id: 'sheet', label: '스프라이트 시트', desc: '한 장에 모든 프레임 · 게임용' },
    { id: 'project', label: '프로젝트 파일', desc: '.ffanim · 나중에 불러오기' },
  ];

  if (done)
    return (
      <Modal icon={<CheckCircle2 size={18} />} title="내보내기 완료" sub={baseName(done)} onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={() => desktop?.showInFolder(done)}>
              <FolderOpen size={15} /> 폴더에서 보기
            </button>
            <button className="btn primary" onClick={onClose}>
              완료
            </button>
          </>
        }
      >
        <div className="card muted" style={{ wordBreak: 'break-all', fontSize: 12.5 }}>{done}</div>
      </Modal>
    );

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
            <Download size={15} /> {progress !== null ? '만드는 중…' : isDesktop ? '저장 위치 고르기' : '내보내기'}
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
      {!isDesktop && webFormats.length === 0 && <div className="muted">이 브라우저는 동영상 녹화를 지원하지 않아요. GIF 로 내보내 주세요.</div>}

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
      {(isVideo || kind === 'gif') && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">{isVideo ? '반복 횟수' : '반복'}</span>
          {isVideo ? (
            <div className="row">
              <Stepper value={loops} onChange={setLoops} min={1} max={20} />
              <span className="muted">번 · {seconds.toFixed(1)}초</span>
            </div>
          ) : (
            <Seg value={loops > 0 ? 1 : 0} onChange={(v) => setLoops(v)} options={[{ value: 1, label: '무한 반복' }, { value: 0, label: '한 번' }]} />
          )}
        </div>
      )}
      {isVideo && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row">
            <Music size={15} color="var(--accent)" />
            <span className="grow">{p.audio ? p.audio.name : '음악 없음 · 타임라인에서 음악을 추가할 수 있어요'}</span>
          </div>
          {p.audio && <Toggle label="영상에 음악 넣기" on={withAudio} onChange={setWithAudio} />}
          {!isDesktop && (
            <div className="muted" style={{ fontSize: 11.5 }}>
              <Film size={11} /> 동영상은 실제 재생 속도로 녹화돼요 (약 {seconds.toFixed(1)}초). 녹화 중에는 이 탭을 열어 두세요.
            </div>
          )}
        </div>
      )}
      {(kind === 'png' || kind === 'pngseq' || kind === 'sheet') && <Toggle label="투명 배경으로 저장" on={transparentPng} onChange={setTransparentPng} />}
      {progress !== null && (
        <div className="field">
          <label>만드는 중… {Math.round(progress * 100)}%</label>
          <div className="progress">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
    </Modal>
  );
}
