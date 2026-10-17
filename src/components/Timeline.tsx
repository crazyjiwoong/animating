import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Repeat, Ghost, Plus, CopyPlus, Trash2, Music, Eye, EyeOff,
  Volume2, VolumeX, SlidersHorizontal, Settings2, ArrowRightToLine, ArrowLeftToLine, MoveHorizontal, Scissors,
} from 'lucide-react';
import type { AudioTrack, Frame, Layer, FrameSound } from '../types';
import { useEditor, runAt } from '../store/editor';
import { renderThumb } from '../lib/render';
import { analyzeFrames, detectBeats, framePeaks, noteColor, noteName, playTone, formatTime } from '../lib/audio';
import { pickFile } from '../lib/id';
import { importAudioFile } from '../lib/importers';
import { trackPointer } from '../lib/drag';
import { Slider, Toggle } from './ui';

export const LABEL_W = 168;

/* ---------------------------------------------------------------- 분석 결과 공유 */

let analysisCache: { key: unknown[]; result: (FrameSound | null)[] } | null = null;
function analyzeCached(audio: AudioTrack, fps: number, n: number) {
  const key = [audio.buffer, audio.startFrame, audio.trim, fps, n];
  if (analysisCache && analysisCache.key.every((v, i) => v === key[i])) return analysisCache.result;
  const result = analyzeFrames(audio, fps, n);
  analysisCache = { key, result };
  return result;
}

export function useFrameSounds(): (FrameSound | null)[] | null {
  const audio = useEditor((s) => s.project?.audio);
  const fps = useEditor((s) => s.project?.fps ?? 12);
  const n = useEditor((s) => s.project?.frames.length ?? 0);
  return useMemo(() => (audio ? analyzeCached(audio, fps, n) : null), [audio?.buffer, audio?.startFrame, audio?.trim, fps, n]);
}

/* ---------------------------------------------------------------- 썸네일 */

const FrameThumb = memo(function FrameThumb(props: { index: number; frame: Frame; layers: Layer[]; bg: string | null; w: number; size: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const p = useEditor.getState().project;
    if (!p || !ref.current) return;
    const run = () => ref.current && renderThumb(p, props.index, props.w * 2, props.w * 2, ref.current);
    // Safari 에는 requestIdleCallback 이 없다
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 300 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(run, 16);
    return () => clearTimeout(id);
  }, [props.frame, props.layers, props.bg, props.w, props.size, props.index]);
  return <canvas ref={ref} />;
});

/* ---------------------------------------------------------------- 레이어 행 */

interface Run {
  a: number;
  b: number;
}
/** 같은 그림(key)이 이어지는 구간들 */
function computeRuns(frames: Frame[], layerId: string): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < frames.length; i++) {
    const c = frames[i].cels[layerId];
    if (!c) continue;
    const last = runs[runs.length - 1];
    if (last && last.b === i - 1 && c.key && frames[i - 1].cels[layerId]?.key === c.key) last.b = i;
    else runs.push({ a: i, b: i });
  }
  return runs;
}

export interface RunMenu {
  x: number;
  y: number;
  layerId: string;
  frame: number;
}

const LayerRow = memo(function LayerRow(props: {
  layer: Layer;
  frames: Frame[];
  start: number;
  end: number;
  col: number;
  selected: boolean;
  /** 선택된 행만 현재 프레임을 받는다 (다른 행은 -1 → 재렌더 없음) */
  cur: number;
  onCell: (frame: number, layerId: string) => void;
  onTap: (frame: number) => void;
  onMenu: (m: RunMenu) => void;
  rawFrameAt: (clientX: number) => number;
}) {
  const { layer, frames, start, end, col } = props;
  const update = useEditor((s) => s.updateLayer);
  const runs = useMemo(() => computeRuns(frames, layer.id), [frames, layer.id]);
  const [drag, setDrag] = useState<{ a: number; b: number; len: number } | null>(null);
  const cells = [];
  for (let i = start; i < end; i++) {
    cells.push(
      <div
        key={i}
        className={'tl-cell' + (i === props.cur ? ' sel' : '')}
        style={{ width: col }}
        onPointerDown={() => props.onCell(i, layer.id)}
        onPointerUp={() => props.onTap(i)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (frames[i].cels[layer.id]) props.onMenu({ x: e.clientX, y: e.clientY, layerId: layer.id, frame: i });
        }}
      />,
    );
  }
  const startHandle = (e: React.PointerEvent, r: Run) => {
    e.stopPropagation();
    e.preventDefault();
    useEditor.getState().setLayer(layer.id);
    let len = r.b - r.a + 1;
    setDrag({ ...r, len });
    trackPointer(
      e,
      (ev) => {
        len = Math.max(1, props.rawFrameAt(ev.clientX) - r.a + 1);
        setDrag({ ...r, len });
      },
      (ev) => {
        setDrag(null);
        if (ev) useEditor.getState().setExposure(layer.id, r.a, r.b, len);
      },
    );
  };
  const blocks = runs
    .filter((r) => r.b >= start - 1 && r.a <= end)
    .map((r) => {
      const len = r.b - r.a + 1;
      const dragging = drag && drag.a === r.a;
      return (
        <div
          key={r.a}
          className={'run' + (dragging ? ' dragging' : '')}
          style={{ left: LABEL_W + r.a * col + 2, width: len * col - 4, background: layer.color, opacity: layer.visible ? undefined : 0.3 }}
        >
          {len > 1 && col * len > 26 && <span className="run-len">{len}</span>}
          <span className="run-h" onPointerDown={(e) => startHandle(e, r)} title="끌어서 이 그림이 나오는 길이 조절" />
        </div>
      );
    });
  return (
    <div className="tl-row layer-row">
      <div className={'tl-label' + (props.selected ? ' sel' : '')} style={{ width: LABEL_W }} onPointerDown={() => useEditor.getState().setLayer(layer.id)}>
        <span className="tag" style={{ background: layer.color }} />
        <span className="nm">{layer.name}</span>
        <button className="icon-btn sm" onClick={() => update(layer.id, { visible: !layer.visible })}>
          {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      </div>
      <div style={{ width: start * col, flex: 'none' }} />
      {cells}
      {blocks}
      {drag && (
        <div className="run-ghost" style={{ left: LABEL_W + drag.a * col + 2, width: drag.len * col - 4 }}>
          <span className="run-tip">
            {drag.len}프레임 · {(drag.len / (useEditor.getState().project?.fps ?? 12)).toFixed(2)}초
          </span>
        </div>
      )}
    </div>
  );
});

function RunMenuView({ menu, onClose }: { menu: RunMenu; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const st = useEditor.getState();
  const p = st.project!;
  const [a, b] = runAt(p.frames, menu.layerId, menu.frame);
  const len = b - a + 1;
  useEffect(() => {
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [onClose]);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <div ref={ref} className="dropdown" style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 250), top: Math.max(8, menu.y - 250) }}>
      <div className="muted" style={{ padding: '6px 10px', fontSize: 11.5 }}>
        프레임 {a + 1}~{b + 1} · {len}프레임 동안 보임
      </div>
      <button onClick={act(() => st.setExposure(menu.layerId, a, b, p.frames.length - a, 'overwrite'))}>
        <ArrowRightToLine size={15} /> 끝까지 늘리기
      </button>
      <button
        onClick={act(() => {
          const v = prompt('몇 프레임 동안 보이게 할까요?', String(len));
          if (v && Number(v) > 0) st.setExposure(menu.layerId, a, b, Number(v));
        })}
      >
        <MoveHorizontal size={15} /> 길이 직접 입력…
      </button>
      <button onClick={act(() => st.setExposure(menu.layerId, a, b, 1))} disabled={len === 1}>
        <ArrowLeftToLine size={15} /> 1프레임으로 줄이기
      </button>
      <hr />
      <button onClick={act(() => st.splitRun(menu.layerId, menu.frame))} disabled={len === 1}>
        <Scissors size={15} /> 여기서 나누기 (따로 편집)
      </button>
      <button onClick={act(() => st.setCel(menu.frame, menu.layerId, null, '그림 지우기'))}>
        <Trash2 size={15} /> 이 그림 지우기
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 오디오 */

function AudioLane({ start, end, col }: { start: number; end: number; col: number }) {
  const audio = useEditor((s) => s.project!.audio!);
  const fps = useEditor((s) => s.project!.fps);
  const n = useEditor((s) => s.project!.frames.length);
  const ref = useRef<HTMLCanvasElement>(null);
  const per = Math.max(2, Math.min(16, Math.round(col / 4)));
  const peaks = useMemo(() => framePeaks(audio, fps, n, per), [audio.buffer, audio.startFrame, audio.trim, fps, n, per]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = (end - start) * col;
    const h = 48;
    c.width = Math.max(1, w * dpr);
    c.height = h * dpr;
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#b4a9ff');
    grad.addColorStop(0.5, '#8b7bff');
    grad.addColorStop(1, '#ff6fb5');
    ctx.fillStyle = grad;
    const bw = col / per;
    let maxAbs = 0.0001;
    for (let i = 0; i < peaks.length; i++) maxAbs = Math.max(maxAbs, Math.abs(peaks[i]));
    const k = (h / 2 - 4) / maxAbs;
    for (let i = start * per; i < end * per; i++) {
      const mn = peaks[i * 2],
        mx = peaks[i * 2 + 1];
      if (mn === 0 && mx === 0) continue;
      const x = (i - start * per) * bw;
      const y0 = h / 2 - mx * k,
        y1 = h / 2 - mn * k;
      ctx.fillRect(x + 0.5, y0, Math.max(1, bw - 1), Math.max(1, y1 - y0));
    }
    // 프레임 구분선
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = start; i < end; i++) ctx.fillRect((i - start) * col, 0, 1, h);
  }, [peaks, start, end, col, per]);
  return (
    <div className="audio-lane" style={{ width: (end - start) * col }}>
      <canvas ref={ref} />
    </div>
  );
}

function NoteRow({ sounds, start, end, col, onCell }: { sounds: (FrameSound | null)[]; start: number; end: number; col: number; onCell: (i: number) => void }) {
  const naming = useEditor((s) => s.noteNaming);
  const beats = useMemo(() => detectBeats(sounds), [sounds]);
  const cells = [];
  for (let i = start; i < end; i++) {
    const s = sounds[i];
    const prev = sounds[i - 1];
    const repeat = s?.midi != null && prev?.midi === s.midi;
    cells.push(
      <div key={i} className="note-cell" style={{ width: col }} onPointerDown={() => onCell(i)} title={s?.freq ? `${noteName(s.midi!, naming)} · ${s.freq.toFixed(1)}Hz · 음량 ${Math.round(s.level * 100)}%` : undefined}>
        {s && <div className="lv" style={{ height: `${s.level * 100}%`, background: s.midi != null ? noteColor(s.midi) : '#7d8395' }} />}
        {beats[i] && <i className="beat" title="박자 (소리가 커지는 지점)" />}
        {s?.midi != null ? (
          <b style={{ background: noteColor(s.midi), opacity: repeat ? 0.45 : 1 }}>{col >= 40 ? noteName(s.midi, naming) : noteName(s.midi, naming, false)}</b>
        ) : s ? (
          <span className="muted" style={{ fontSize: 10 }}>{s.level < 0.04 ? '·' : '?'}</span>
        ) : null}
      </div>,
    );
  }
  return <>{cells}</>;
}

function AudioPopover({ onClose }: { onClose: () => void }) {
  const audio = useEditor((s) => s.project!.audio);
  const fps = useEditor((s) => s.project!.fps);
  const n = useEditor((s) => s.project!.frames.length);
  const naming = useEditor((s) => s.noteNaming);
  const scrub = useEditor((s) => s.scrubSound);
  const st = useEditor.getState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-audio-btn]') && onClose();
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [onClose]);
  const pick = async () => {
    const f = (await pickFile('audio/*'))[0];
    if (f) importAudioFile(f, f.name);
  };
  return (
    <div ref={ref} className="dropdown" style={{ bottom: 'calc(100% + 6px)', top: 'auto', width: 300, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!audio ? (
        <>
          <b>음악 추가</b>
          <span className="muted" style={{ lineHeight: 1.5 }}>MP3, WAV, M4A, OGG 파일을 넣으면 파형과 함께 프레임마다 어떤 음이 나는지 분석해요.</span>
          <button className="btn primary" onClick={pick}>
            <Music size={15} /> 음악 파일 선택
          </button>
        </>
      ) : (
        <>
          <div className="row">
            <Music size={15} color="var(--accent)" />
            <b className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{audio.name}</b>
            <span className="muted">{formatTime(audio.buffer.duration)}</span>
          </div>
          <Slider label="볼륨" value={Math.round(audio.volume * 100)} min={0} max={150} onChange={(v) => st.updateAudio({ volume: v / 100 })} format={(v) => `${v}%`} />
          <div className="grid2" style={{ gap: 8 }}>
            <div className="field">
              <label>시작 프레임</label>
              <input className="input" type="number" min={1} value={audio.startFrame + 1} onChange={(e) => st.updateAudio({ startFrame: Math.max(0, Math.round(Number(e.target.value) || 1) - 1) })} />
            </div>
            <div className="field">
              <label>앞부분 자르기 (초)</label>
              <input className="input" type="number" min={0} step={0.1} value={audio.trim} onChange={(e) => st.updateAudio({ trim: Math.max(0, Number(e.target.value) || 0) })} />
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">음 이름 표시</span>
            <div className="seg">
              <button className={naming === 'ko' ? 'on' : ''} onClick={() => st.set({ noteNaming: 'ko' })}>도레미</button>
              <button className={naming === 'en' ? 'on' : ''} onClick={() => st.set({ noteNaming: 'en' })}>CDE</button>
            </div>
          </div>
          <Toggle label="프레임 이동할 때 소리 듣기 (스크럽)" on={scrub} onChange={(v) => st.set({ scrubSound: v })} />
          <Toggle label="음소거" on={audio.muted} onChange={(muted) => st.updateAudio({ muted })} />
          <div className="muted" style={{ fontSize: 11.5 }}>
            음악 {Math.ceil((audio.buffer.duration - audio.trim) * fps)}프레임 분량 · 현재 애니메이션 {n}프레임
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm grow" onClick={() => st.extendToAudio()}>음악 길이만큼 프레임 늘리기</button>
            <button className="btn sm" onClick={pick}>교체</button>
            <button className="btn sm danger" onClick={() => { st.setAudio(null); onClose(); }}>
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function OnionPopover({ onClose }: { onClose: () => void }) {
  const onion = useEditor((s) => s.onion);
  const set = useEditor((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-onion-btn]') && onClose();
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [onClose]);
  return (
    <div ref={ref} className="dropdown" style={{ bottom: 'calc(100% + 6px)', top: 'auto', width: 260, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Toggle label="이전 프레임 겹쳐 보기" on={onion.enabled} onChange={(enabled) => set({ onion: { ...onion, enabled } })} />
      <Slider label="불투명도" value={Math.round(onion.opacity * 100)} min={5} max={90} onChange={(v) => set({ onion: { ...onion, opacity: v / 100 } })} format={(v) => `${v}%`} />
      <div className="seg" style={{ display: 'flex' }}>
        <button style={{ flex: 1 }} className={onion.mode === 'plain' ? 'on' : ''} onClick={() => set({ onion: { ...onion, mode: 'plain' } })}>원래 색</button>
        <button style={{ flex: 1 }} className={onion.mode === 'tint' ? 'on' : ''} onClick={() => set({ onion: { ...onion, mode: 'tint' } })}>색 입히기</button>
      </div>
      <button
        className="btn sm"
        onClick={() => {
          onClose();
          set({ dialog: { type: 'settings', tab: 'view' } });
        }}
      >
        자세한 설정 (장 수 · 다음 프레임)
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 타임라인 */

export function Timeline() {
  const p = useEditor((s) => s.project)!;
  const fi = useEditor((s) => s.frameIndex);
  const layerId = useEditor((s) => s.layerId);
  const playing = useEditor((s) => s.playing);
  const loop = useEditor((s) => s.loop);
  const speed = useEditor((s) => s.playSpeed);
  const onion = useEditor((s) => s.onion);
  const col = useEditor((s) => s.timelineCol);
  const naming = useEditor((s) => s.noteNaming);
  const st = useEditor.getState();
  const sounds = useFrameSounds();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1200 });
  const [pop, setPop] = useState<null | 'audio' | 'onion'>(null);
  const lastTap = useRef({ t: 0, i: -1 });
  const [dragFrame, setDragFrame] = useState<{ from: number; to: number } | null>(null);

  const n = p.frames.length;
  const start = Math.max(0, Math.floor((view.left - LABEL_W) / col) - 4);
  const end = Math.min(n, Math.ceil((view.left + view.width) / col) + 4);
  const showThumbs = col >= 44;
  const layersTopFirst = useMemo(() => [...p.layers].reverse(), [p.layers]);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const upd = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(upd);
    };
    el.addEventListener('scroll', onScroll);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // 현재 프레임이 보이도록 스크롤
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = LABEL_W + fi * col;
    if (x < el.scrollLeft + LABEL_W) el.scrollLeft = x - LABEL_W - col;
    else if (x + col > el.scrollLeft + el.clientWidth) el.scrollLeft = x + col * 2 - el.clientWidth;
  }, [fi, col]);

  const onCell = (i: number, lid?: string) => {
    st.setFrame(i);
    if (lid) st.setLayer(lid);
  };
  const onTap = (i: number) => {
    const now = performance.now();
    if (lastTap.current.i === i && now - lastTap.current.t < 380) {
      st.set({ dialog: { type: 'frame', index: i } });
      lastTap.current = { t: 0, i: -1 };
    } else lastTap.current = { t: now, i };
  };

  // 헤더 드래그 = 스크럽, 썸네일 드래그 = 프레임 순서 이동
  const rawFrameAt = useCallback((clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return Math.floor((clientX - r.left + el.scrollLeft - LABEL_W) / col);
  }, [col]);
  const frameAt = (clientX: number) => Math.max(0, Math.min(n - 1, rawFrameAt(clientX)));
  const [menu, setMenu] = useState<RunMenu | null>(null);
  const scrubStart = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      st.setFrame(frameAt(e.clientX));
      return;
    }
    const go = (x: number) => st.setFrame(frameAt(x));
    go(e.clientX);
    trackPointer(e, (ev) => go(ev.clientX));
  };
  const thumbDragStart = (e: React.PointerEvent, i: number) => {
    st.setFrame(i);
    const sx = e.clientX;
    let active = false;
    let to = i;
    trackPointer(
      e,
      (ev) => {
        // 터치는 가로 스크롤을 우선한다 (순서 변경은 프레임 설정 창에서)
        if (ev.pointerType === 'touch') return;
        if (!active && Math.abs(ev.clientX - sx) < 8) return;
        active = true;
        to = frameAt(ev.clientX);
        setDragFrame({ from: i, to });
      },
      (ev) => {
        setDragFrame(null);
        if (!ev) return;
        if (active && to !== i) st.moveFrame(i, to);
        else onTap(i);
      },
    );
  };

  const resizeStart = (e: React.PointerEvent) => {
    const sy = e.clientY;
    const h0 = useEditor.getState().timelineH;
    trackPointer(e, (ev) => st.set({ timelineH: Math.max(150, Math.min(window.innerHeight * 0.7, h0 - (ev.clientY - sy))) }));
  };

  const cur = sounds?.[fi];
  const totalW = LABEL_W + n * col;
  const spacer = <div style={{ width: start * col, flex: 'none' }} />;
  const nums = [];
  const thumbs = [];
  for (let i = start; i < end; i++) {
    const isSec = i % p.fps === 0;
    nums.push(
      <div key={i} className={'tl-num' + (isSec ? ' sec' : '') + (i === fi ? ' cur' : '')} style={{ width: col }} onPointerUp={() => onTap(i)}>
        {isSec && col < 30 ? `${i / p.fps}s` : i + 1}
        {p.frames[i].memo && <span className="memo-dot" />}
      </div>,
    );
    if (showThumbs)
      thumbs.push(
        <div
          key={i}
          className={'tl-thumb' + (i === fi ? ' cur' : '') + (dragFrame && dragFrame.to === i ? ' drag-over' : '')}
          style={{ width: col, opacity: dragFrame?.from === i ? 0.4 : 1 }}
          onPointerDown={(e) => thumbDragStart(e, i)}
          title="두 번 눌러 프레임 설정 · 드래그로 순서 변경"
        >
          <FrameThumb index={i} frame={p.frames[i]} layers={p.layers} bg={p.background} w={col - 6} size={`${p.width}x${p.height}`} />
        </div>,
      );
  }

  return (
    <div className="timeline">
      <div className="tl-resize" onPointerDown={resizeStart} />
      <div className="tl-bar">
        <button className="icon-btn" onClick={() => st.setFrame(0)} title="처음으로 (Home)">
          <SkipBack size={15} />
        </button>
        <button className="icon-btn" onClick={() => st.setFrame(fi - 1)} title="이전 프레임 (,)">
          <ChevronLeft size={17} />
        </button>
        <button className="play-btn" onClick={() => st.set({ playing: !playing })} title="재생/정지 (Enter)">
          {playing ? <Pause size={15} fill="#fff" /> : <Play size={15} fill="#fff" style={{ marginLeft: 2 }} />}
        </button>
        <button className="icon-btn" onClick={() => st.setFrame(fi + 1)} title="다음 프레임 (.)">
          <ChevronRight size={17} />
        </button>
        <button className="icon-btn" onClick={() => st.setFrame(n - 1)} title="끝으로 (End)">
          <SkipForward size={15} />
        </button>
        <div className="tl-counter">
          {fi + 1} <span>/ {n}</span>
          <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 500 }}>
            {formatTime(fi / p.fps)} · {p.fps}fps
          </div>
        </div>
        <button className={'icon-btn' + (loop ? ' active' : '')} onClick={() => st.set({ loop: !loop })} title="반복 재생">
          <Repeat size={15} />
        </button>
        <select className="select speed-sel" value={speed} onChange={(e) => st.set({ playSpeed: Number(e.target.value) })} title="재생 속도 (타이밍 확인용)">
          {[0.25, 0.5, 0.75, 1, 1.5, 2].map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
        <div className="menu-wrap">
          <button
            data-onion-btn
            className={'icon-btn' + (onion.enabled ? ' active' : '')}
            onClick={() => st.set({ onion: { ...onion, enabled: !onion.enabled } })}
            onContextMenu={(e) => {
              e.preventDefault();
              setPop(pop === 'onion' ? null : 'onion');
            }}
            title="이전 프레임 겹쳐 보기 (O · 우클릭: 설정)"
          >
            <Ghost size={15} />
          </button>
          {pop === 'onion' && <OnionPopover onClose={() => setPop(null)} />}
        </div>
        <button data-onion-btn className="icon-btn sm" onClick={() => setPop(pop === 'onion' ? null : 'onion')} title="어니언 스킨 설정">
          <SlidersHorizontal size={12} />
        </button>
        <div className="divider" />
        <button className="btn sm ghost" onClick={() => st.addFrame()} title="빈 프레임 추가">
          <Plus size={14} /> 프레임
        </button>
        <button className="btn sm ghost" onClick={() => st.duplicateFrame(fi, 1)} title="현재 프레임 복제 (Ctrl+D)">
          <CopyPlus size={14} /> 복제
        </button>
        <button className="icon-btn" onClick={() => st.set({ dialog: { type: 'frame', index: fi } })} title="프레임 설정 (프레임을 두 번 눌러도 돼요)">
          <Settings2 size={15} />
        </button>
        <button className="icon-btn" onClick={() => st.deleteFrame(fi)} title="프레임 삭제">
          <Trash2 size={15} />
        </button>
        <div className="divider" />
        <div className="menu-wrap">
          <button data-audio-btn className={'btn sm' + (p.audio ? '' : ' ghost')} onClick={() => setPop(pop === 'audio' ? null : 'audio')}>
            <Music size={14} /> {p.audio ? '음악' : '음악 추가'}
          </button>
          {pop === 'audio' && <AudioPopover onClose={() => setPop(null)} />}
        </div>
        <div className="tl-info">
          {cur && cur.midi != null ? (
            <>
              <span className="note-pill" title="이 프레임에서 가장 두드러진 음">
                <i style={{ background: noteColor(cur.midi) }}>♪</i>
                {noteName(cur.midi, naming)}
                <span className="muted" style={{ fontWeight: 500 }}>{cur.freq!.toFixed(0)}Hz</span>
              </span>
              <button className="icon-btn sm" onClick={() => playTone(cur.freq!)} title="이 음 들어보기">
                <Volume2 size={13} />
              </button>
              <span className="muted">음량 {Math.round(cur.level * 100)}%</span>
            </>
          ) : cur ? (
            <span className="muted">{cur.level < 0.04 ? '무음' : '음 불분명'} · 음량 {Math.round(cur.level * 100)}%</span>
          ) : null}
          <input
            type="range"
            min={20}
            max={96}
            value={col}
            onChange={(e) => st.set({ timelineCol: Number(e.target.value) })}
            style={{ width: 90, ['--p' as string]: `${((col - 20) / 76) * 100}%` }}
            title="타임라인 확대"
          />
        </div>
      </div>
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-grid" style={{ width: totalW }}>
          <div className="tl-row head" onPointerDown={scrubStart}>
            <div className="tl-label" style={{ width: LABEL_W }}>
              <span className="muted">프레임</span>
            </div>
            {spacer}
            {nums}
          </div>
          {showThumbs && (
            <div className="tl-row thumbs">
              <div className="tl-label" style={{ width: LABEL_W, alignSelf: 'stretch' }}>
                <span className="muted">미리보기</span>
              </div>
              {spacer}
              {thumbs}
            </div>
          )}
          {layersTopFirst.map((l) => (
            <LayerRow key={l.id} layer={l} frames={p.frames} start={start} end={end} col={col} selected={l.id === layerId} cur={l.id === layerId ? fi : -1} onCell={onCell} onTap={onTap} onMenu={setMenu} rawFrameAt={rawFrameAt} />
          ))}
          {p.audio && sounds ? (
            <>
              <div className="tl-row audio">
                <div className="tl-label" style={{ width: LABEL_W, height: 48, flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 2 }}>
                  <div className="row" style={{ width: '100%', gap: 6 }}>
                    <Music size={13} color="var(--accent)" />
                    <span className="nm" style={{ color: 'var(--text)' }}>{p.audio.name}</span>
                    <button className="icon-btn sm" onClick={() => st.updateAudio({ muted: !p.audio!.muted })} title="음소거">
                      {p.audio.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                    </button>
                  </div>
                  <span className="muted" style={{ fontSize: 10.5 }}>{formatTime(p.audio.buffer.duration)} · 파형</span>
                </div>
                {spacer}
                <AudioLane start={start} end={end} col={col} />
              </div>
              <div className="tl-row notes">
                <div className="tl-label" style={{ width: LABEL_W }}>
                  <span className="nm">프레임별 음</span>
                  <span className="muted" style={{ fontSize: 10 }}>{naming === 'ko' ? '도레미' : 'CDE'}</span>
                </div>
                {spacer}
                <NoteRow sounds={sounds} start={start} end={end} col={col} onCell={(i) => onCell(i)} />
              </div>
            </>
          ) : (
            <div className="tl-row" style={{ height: 40 }}>
              <div className="tl-label" style={{ width: LABEL_W }}>
                <Music size={13} />
                <span className="nm">음악</span>
              </div>
              <div className="add-audio" style={{ position: 'sticky', left: LABEL_W }}>
                <button className="btn sm" onClick={async () => { const f = (await pickFile('audio/*'))[0]; if (f) importAudioFile(f, f.name); }}>
                  <Plus size={13} /> 음악 추가
                </button>
                음악을 넣으면 프레임마다 어떤 음이 나오는지 보여드려요
              </div>
            </div>
          )}
          <div className="playhead" style={{ left: LABEL_W + fi * col + col / 2 - 1 }} />
          {menu && <RunMenuView menu={menu} onClose={() => setMenu(null)} />}
        </div>
      </div>
    </div>
  );
}
