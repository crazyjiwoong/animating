import { useEffect, type ReactNode } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import { useEditor } from '../../store/editor';
import { clamp } from '../../lib/id';

export function Modal(props: {
  title: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props.onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={'modal' + (props.wide ? ' wide' : '')} role="dialog" aria-modal>
        <div className="modal-head">
          {props.icon && <div className="modal-ic">{props.icon}</div>}
          <div className="grow">
            <h2>{props.title}</h2>
            {props.sub && <div className="sub">{props.sub}</div>}
          </div>
          <button className="icon-btn" onClick={props.onClose} aria-label="닫기">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const p = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <div className="slider">
      <span className="s-label">{props.label}</span>
      <span className="s-value">{props.format ? props.format(props.value) : props.value}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        style={{ ['--p' as string]: `${p}%` }}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Toggle(props: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
      {props.label && <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{props.label}</span>}
      <button type="button" className={'toggle' + (props.on ? ' on' : '')} onClick={() => props.onChange(!props.on)} aria-pressed={props.on} />
    </label>
  );
}

export function Seg<T extends string | number>(props: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button key={String(o.value)} className={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper(props: { value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  const min = props.min ?? 1;
  const max = props.max ?? 500;
  return (
    <div className="stepper">
      <button onClick={() => props.onChange(clamp(props.value - 1, min, max))} aria-label="감소">
        <Minus size={15} />
      </button>
      <input
        type="number"
        value={props.value}
        min={min}
        max={max}
        onChange={(e) => props.onChange(clamp(Math.round(Number(e.target.value) || min), min, max))}
      />
      <button onClick={() => props.onChange(clamp(props.value + 1, min, max))} aria-label="증가">
        <Plus size={15} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          <span className="dot" />
          {t.text}
        </div>
      ))}
    </div>
  );
}
