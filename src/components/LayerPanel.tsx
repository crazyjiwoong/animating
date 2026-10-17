import { memo, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, LockOpen, Plus, Copy, Trash2, ArrowUp, ArrowDown, Merge, ImagePlus, Image as ImageIcon, Brush, Grid2x2Check } from 'lucide-react';
import type { BlendMode, Layer } from '../types';
import { useEditor, currentLayer } from '../store/editor';
import { drawCel } from '../lib/render';
import { ctx2d } from '../lib/canvas';
import { pickFile } from '../lib/id';
import { importFiles } from '../lib/importers';
import { trackPointer } from '../lib/drag';

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: '표준' },
  { value: 'multiply', label: '곱하기' },
  { value: 'screen', label: '스크린' },
  { value: 'overlay', label: '오버레이' },
  { value: 'darken', label: '어둡게' },
  { value: 'lighten', label: '밝게' },
  { value: 'color-dodge', label: '닷지' },
  { value: 'color-burn', label: '번' },
  { value: 'hard-light', label: '하드 라이트' },
  { value: 'soft-light', label: '소프트 라이트' },
  { value: 'difference', label: '차이' },
  { value: 'lighter', label: '더하기 (발광)' },
  { value: 'hue', label: '색조' },
  { value: 'color', label: '컬러' },
  { value: 'luminosity', label: '광도' },
];

const LayerThumb = memo(function LayerThumb({ layerId }: { layerId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cel = useEditor((s) => s.project?.frames[s.frameIndex]?.cels[layerId]);
  const size = useEditor((s) => (s.project ? `${s.project.width}x${s.project.height}` : ''));
  const playing = useEditor((s) => s.playing);
  useEffect(() => {
    const c = ref.current;
    const p = useEditor.getState().project;
    // 재생 중에는 썸네일을 갱신하지 않는다
    if (!c || !p || playing) return;
    const s = Math.min(88 / p.width, 64 / p.height);
    c.width = Math.max(1, Math.round(p.width * s));
    c.height = Math.max(1, Math.round(p.height * s));
    const ctx = ctx2d(c);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!cel) return;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    drawCel(ctx, p, cel);
  }, [cel, layerId, size, playing]);
  return (
    <div className="lthumb">
      <canvas ref={ref} style={{ objectFit: 'contain' }} />
    </div>
  );
});

function LayerRow({ layer, index, dropMark, onDragStart }: { layer: Layer; index: number; dropMark: 'above' | 'below' | null; onDragStart: (e: React.PointerEvent, id: string) => void }) {
  const sel = useEditor((s) => s.layerId === layer.id);
  const setLayer = useEditor((s) => s.setLayer);
  const update = useEditor((s) => s.updateLayer);
  const [editing, setEditing] = useState(false);
  return (
    <div
      className={'layer' + (sel ? ' sel' : '') + (layer.visible ? '' : ' hidden') + (dropMark ? ' drop-' + dropMark : '')}
      data-index={index}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button,input')) return;
        setLayer(layer.id);
        onDragStart(e, layer.id);
      }}
      onDoubleClick={() => setEditing(true)}
    >
      <span className="tag" style={{ background: layer.color }} />
      <button className="icon-btn sm" onClick={() => update(layer.id, { visible: !layer.visible })} title={layer.visible ? '숨기기' : '보이기'}>
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <LayerThumb layerId={layer.id} />
      <div className="lname">
        {editing ? (
          <input
            autoFocus
            defaultValue={layer.name}
            onBlur={(e) => {
              setEditing(false);
              if (e.target.value.trim() && e.target.value !== layer.name) update(layer.id, { name: e.target.value.trim() });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
              e.stopPropagation();
            }}
          />
        ) : (
          <b>{layer.name}</b>
        )}
        <span>
          {layer.kind === 'image' ? <ImageIcon size={11} /> : <Brush size={11} />}
          {Math.round(layer.opacity * 100)}% · {BLEND_MODES.find((b) => b.value === layer.blend)?.label}
          {layer.alphaLock && <Grid2x2Check size={11} />}
        </span>
      </div>
      <button className={'icon-btn sm' + (layer.locked ? ' active' : '')} onClick={() => update(layer.id, { locked: !layer.locked })} title={layer.locked ? '잠금 해제' : '잠그기'}>
        {layer.locked ? <Lock size={13} /> : <LockOpen size={13} style={{ opacity: 0.45 }} />}
      </button>
    </div>
  );
}

export function LayerPanel() {
  const layers = useEditor((s) => s.project!.layers);
  const layer = useEditor(currentLayer);
  const s = useEditor.getState();
  const addLayer = useEditor((s) => s.addLayer);
  const update = useEditor((s) => s.updateLayer);
  const listRef = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<{ id: string; to: number; mark: { index: number; pos: 'above' | 'below' } } | null>(null);

  // 포인터로 순서 바꾸기
  const onDragStart = (e: React.PointerEvent, id: string) => {
    const startY = e.clientY;
    let active = false;
    let target: typeof drop = null;
    trackPointer(
      e,
      (ev) => {
        if (ev.pointerType === 'touch') return;
        if (!active && Math.abs(ev.clientY - startY) < 6) return;
        active = true;
        const rows = Array.from(listRef.current!.querySelectorAll<HTMLElement>('.layer'));
        let best: typeof drop = null;
        for (const r of rows) {
          const rect = r.getBoundingClientRect();
          const idx = Number(r.dataset.index);
          if (ev.clientY < rect.top + rect.height / 2) {
            // 화면상 위 = 배열상 더 큰 인덱스
            best = { id, to: idx, mark: { index: idx, pos: 'above' } };
            break;
          }
          best = { id, to: idx, mark: { index: idx, pos: 'below' } };
        }
        if (best) {
          const from = layers.findIndex((l) => l.id === id);
          // 위쪽에 놓으면 그 레이어보다 위(인덱스+1), 아래쪽이면 그 레이어 자리
          let to = best.mark.pos === 'above' ? best.mark.index + 1 : best.mark.index;
          if (from < to) to -= 1;
          best.to = to;
        }
        target = best;
        setDrop(best);
      },
      (ev) => {
        if (ev && active && target) useEditor.getState().reorderLayer(id, target.to);
        setDrop(null);
      },
    );
  };

  const shown = [...layers].map((l, i) => ({ l, i })).reverse();
  return (
    <div className="panel layers">
      <div className="panel-head">
        레이어 <span className="muted" style={{ fontWeight: 500 }}>{layers.length}</span>
        <span className="grow" />
        <button className="icon-btn sm" title="이미지 가져오기" onClick={async () => importFiles(await pickFile('image/*', true))}>
          <ImagePlus size={14} />
        </button>
        <button className="icon-btn sm" title="새 레이어" onClick={() => addLayer('raster')}>
          <Plus size={15} />
        </button>
      </div>
      {layer && (
        <div className="layer-props">
          <div className="row" style={{ gap: 10 }}>
            <span className="label" style={{ width: 42 }}>불투명도</span>
            <input
              type="range"
              className="grow"
              min={0}
              max={100}
              value={Math.round(layer.opacity * 100)}
              style={{ ['--p' as string]: `${layer.opacity * 100}%` }}
              onChange={(e) => update(layer.id, { opacity: Number(e.target.value) / 100 }, 'opacity')}
            />
            <span className="s-value" style={{ fontSize: 12, fontWeight: 600, width: 34, textAlign: 'right' }}>{Math.round(layer.opacity * 100)}%</span>
          </div>
          <div className="row">
            <span className="label" style={{ width: 42 }}>합성</span>
            <select className="select grow" style={{ height: 28 }} value={layer.blend} onChange={(e) => update(layer.id, { blend: e.target.value as BlendMode })}>
              {BLEND_MODES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            {layer.kind === 'raster' && (
              <button
                className={'icon-btn' + (layer.alphaLock ? ' active' : '')}
                onClick={() => update(layer.id, { alphaLock: !layer.alphaLock })}
                title="투명 픽셀 잠금 (이미 그린 곳에만 칠하기)"
              >
                <Grid2x2Check size={15} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="layer-list" ref={listRef}>
        {shown.map(({ l, i }) => (
          <LayerRow key={l.id} layer={l} index={i} onDragStart={onDragStart} dropMark={drop && drop.mark.index === i ? drop.mark.pos : null} />
        ))}
      </div>
      {layer && (
        <div className="layer-tools">
          <button className="icon-btn" title="새 레이어" onClick={() => addLayer('raster')}>
            <Plus size={15} />
          </button>
          <button className="icon-btn" title="레이어 복제" onClick={() => s.duplicateLayer(layer.id)}>
            <Copy size={15} />
          </button>
          <button className="icon-btn" title="아래 레이어와 합치기" onClick={() => s.mergeDown(layer.id)} disabled={layers[0]?.id === layer.id}>
            <Merge size={15} />
          </button>
          {layer.kind === 'image' && (
            <button className="btn sm ghost" title="그림을 그릴 수 있게 래스터 레이어로 변환" onClick={() => s.rasterizeLayer(layer.id)}>
              래스터화
            </button>
          )}
          <span className="grow" />
          <button className="icon-btn" title="위로" onClick={() => s.moveLayer(layer.id, 1)}>
            <ArrowUp size={15} />
          </button>
          <button className="icon-btn" title="아래로" onClick={() => s.moveLayer(layer.id, -1)}>
            <ArrowDown size={15} />
          </button>
          <button className="icon-btn" title="레이어 삭제" onClick={() => s.deleteLayer(layer.id)} disabled={layers.length <= 1}>
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
