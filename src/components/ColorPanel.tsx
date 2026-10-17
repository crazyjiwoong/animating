import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useEditor } from '../store/editor';
import { hexToRgb, rgbToHex } from '../lib/canvas';
import { clamp } from '../lib/id';

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

const PALETTE = ['#1d1f2b', '#ffffff', '#8a8f9e', '#ff5d73', '#ff9f43', '#ffd23f', '#5ee38c', '#3fd6c6', '#45b8ff', '#5b6cff', '#8b7bff', '#ff6fd0', '#f4c7a1', '#c08552', '#6b4226', '#000000'];

export function ColorPanel() {
  const color = useEditor((s) => s.color);
  const recent = useEditor((s) => s.recentColors);
  const setColor = useEditor((s) => s.setColor);
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...hexToRgb(color)));
  const [hex, setHex] = useState(color);
  const lastOut = useRef(color);
  const [open, setOpen] = useState(true);

  // 바깥에서 색이 바뀐 경우 (스포이드 등)
  useEffect(() => {
    setHex(color);
    if (color.toLowerCase() !== lastOut.current.toLowerCase()) {
      const n = rgbToHsv(...hexToRgb(color));
      setHsv((old) => (n[1] === 0 || n[2] === 0 ? [old[0], n[1], n[2]] : n));
    }
  }, [color]);

  const emit = (h: [number, number, number], remember: boolean) => {
    setHsv(h);
    const c = hsvToHex(...h);
    lastOut.current = c;
    setColor(c, remember);
  };

  const dragOn = (fn: (x: number, y: number, done: boolean) => void) => (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const go = (ev: PointerEvent | React.PointerEvent, done: boolean) =>
      fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1), done);
    go(e, false);
    const move = (ev: PointerEvent) => go(ev, false);
    const up = (ev: PointerEvent) => {
      go(ev, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div className="panel">
      <div className="panel-head" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <span className="cur-dot" style={{ background: color }} />
        색상
        <span className="grow" />
        <ChevronDown size={14} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
      </div>
      {open && <div className="panel-body">
        <div
          className="sv-box"
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv[0]} 100% 50%))` }}
          onPointerDown={dragOn((x, y, done) => emit([hsv[0], x, 1 - y], done))}
        >
          <div className="knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: color }} />
        </div>
        <div className="hue-bar" onPointerDown={dragOn((x, _y, done) => emit([x * 360, hsv[1], hsv[2]], done))}>
          <div className="knob" style={{ left: `${(hsv[0] / 360) * 100}%`, background: `hsl(${hsv[0]} 100% 50%)` }} />
        </div>
        <div className="hex-row">
          <div className="cur" style={{ background: color }} />
          <input
            className="input grow"
            value={hex}
            onChange={(e) => {
              setHex(e.target.value);
              if (/^#?[0-9a-f]{6}$/i.test(e.target.value)) {
                const c = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value;
                setColor(c);
              }
            }}
          />
        </div>
        <div className="swatches">
          {PALETTE.map((c) => (
            <button key={c} className={'swatch' + (c.toLowerCase() === color.toLowerCase() ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} title={c} />
          ))}
        </div>
        {recent.length > 0 && (
          <>
            <span className="label">최근 사용</span>
            <div className="swatches">
              {recent.slice(0, 8).map((c) => (
                <button key={c} className="swatch" style={{ background: c }} onClick={() => setColor(c)} title={c} />
              ))}
            </div>
          </>
        )}
      </div>}
    </div>
  );
}
