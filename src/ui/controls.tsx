/** Reusable UI controls: sliders with keyframe buttons, popovers, tooltips, segmented controls. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { keyAt, removeKey } from '../scene/animation';
import { writePath } from '../scene/model';
import { currentValue, useApp, useValue } from '../scene/store';
import { GLOSSARY, type GlossaryKey } from './glossary';
import { Icon } from './icons';

// ---------------------------------------------------------------- tooltips

interface TipState {
  content: ReactNode;
  rect: DOMRect;
}

let setGlobalTip: ((t: TipState | null) => void) | null = null;

/** Renders the single floating tooltip (mount once). */
export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useEffect(() => {
    setGlobalTip = setTip;
    // A hovered element can disappear (e.g. after clicking "delete") without a mouseleave,
    // so any press, scroll or wheel dismisses the tooltip. Terms re-open theirs on click.
    const hide = () => setTip(null);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('scroll', hide, true);
    return () => {
      setGlobalTip = null;
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const el = ref.current.getBoundingClientRect();
    let left = tip.rect.left + tip.rect.width / 2 - el.width / 2;
    left = Math.max(8, Math.min(window.innerWidth - el.width - 8, left));
    let top = tip.rect.bottom + 8;
    if (top + el.height > window.innerHeight - 8) top = tip.rect.top - el.height - 8;
    setPos({ left, top });
  }, [tip]);
  if (!tip) return null;
  return createPortal(
    <div ref={ref} className="tooltip" role="tooltip" style={pos}>
      {tip.content}
    </div>,
    document.body,
  );
}

/** Keyboard focus only: a mouse click also focuses buttons, and should not pop a tooltip. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export function showTip(content: ReactNode, el: Element) {
  setGlobalTip?.({ content, rect: el.getBoundingClientRect() });
}
export function hideTip() {
  setGlobalTip?.(null);
}

/** A glossary term with a dotted underline and a definition on hover, focus or tap. */
export function Term({ k, children }: { k: GlossaryKey; children?: ReactNode }) {
  const g = GLOSSARY[k];
  const content = (
    <>
      <b>{g.term}.</b> {g.text}
    </>
  );
  return (
    <span
      className="term"
      tabIndex={0}
      role="button"
      aria-label={`${g.term}: ${g.text}`}
      onMouseEnter={(e) => showTip(content, e.currentTarget)}
      onMouseLeave={hideTip}
      onFocus={(e) => focusVisible(e.currentTarget) && showTip(content, e.currentTarget)}
      onBlur={hideTip}
      onClick={(e) => {
        e.stopPropagation();
        showTip(content, e.currentTarget);
      }}
    >
      {children ?? g.term}
    </span>
  );
}

/** Hover hint for icon buttons (also exposed as aria-label). */
export function useHint(text: string) {
  return {
    'aria-label': text,
    onMouseEnter: (e: React.MouseEvent) => showTip(text, e.currentTarget),
    onMouseLeave: hideTip,
    onFocus: (e: React.FocusEvent) => focusVisible(e.currentTarget) && showTip(text, e.currentTarget),
    onBlur: hideTip,
  };
}

// ---------------------------------------------------------------- popover

export function Popover({
  anchor,
  open,
  onClose,
  children,
  className = '',
  placement = 'below',
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: 'below' | 'above';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const place = () => {
      if (!ref.current) return;
      const a = anchor.getBoundingClientRect();
      const el = ref.current.getBoundingClientRect();
      let left = a.left;
      left = Math.max(8, Math.min(window.innerWidth - el.width - 8, left));
      let top = placement === 'above' ? a.top - el.height - 6 : a.bottom + 6;
      if (top + el.height > window.innerHeight - 8) top = Math.max(8, a.top - el.height - 6);
      if (top < 8) top = Math.min(window.innerHeight - el.height - 8, a.bottom + 6);
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor, placement]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor?.focus();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open, anchor, onClose]);
  if (!open) return null;
  return createPortal(
    <div ref={ref} className={`popover ${className}`} style={pos} role="dialog">
      {children}
    </div>,
    document.body,
  );
}

/** Button + popover pair. */
export function PopButton({
  label,
  className = 'btn',
  children,
  hint,
  popClass,
  placement,
}: {
  label: ReactNode;
  className?: string;
  children: (close: () => void) => ReactNode;
  hint?: string;
  popClass?: string;
  placement?: 'below' | 'above';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const hintProps = useHint(hint ?? '');
  return (
    <>
      <button
        ref={ref}
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          hideTip();
          setOpen((o) => !o);
        }}
        {...(hint ? hintProps : {})}
      >
        {label}
      </button>
      <Popover anchor={ref.current} open={open} onClose={close} className={popClass} placement={placement}>
        {children(close)}
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------- small controls

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  full,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; hint?: string }[];
  onChange: (v: T) => void;
  full?: boolean;
  label: string;
}) {
  return (
    <div className={`seg${full ? ' full' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          title={o.hint}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="switch">
      <span>{children}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function fmt(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '–';
  const s = v.toFixed(digits);
  return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s;
}

/** Number box: drag horizontally to scrub, click to type. */
export function NumberField({
  value,
  onChange,
  step,
  digits = 2,
  min = -Infinity,
  max = Infinity,
  suffix = '',
  label,
}: {
  value: number;
  onChange: (v: number, final: boolean) => void;
  step: number;
  digits?: number;
  min?: number;
  max?: number;
  suffix?: string;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <input
      ref={ref}
      className="num"
      aria-label={label}
      inputMode="decimal"
      value={editing ? text : `${fmt(value, digits)}${suffix}`}
      readOnly={!editing}
      onPointerDown={(e) => {
        if (editing || e.button !== 0) return;
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 2) d.moved = true;
        if (d.moved) {
          const factor = e.shiftKey ? 0.1 : 1;
          const v = clamp(d.v + Math.round((dx * factor) / 2) * step);
          onChange(Number(v.toFixed(6)), false);
        }
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) {
          setText(fmt(value, digits));
          setEditing(true);
          requestAnimationFrame(() => {
            ref.current?.focus();
            ref.current?.select();
          });
        } else if (d) onChange(value, true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (!editing) return;
        setEditing(false);
        const v = parseFloat(text);
        if (Number.isFinite(v)) onChange(clamp(v), true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') {
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        } else if (!editing && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          onChange(clamp(value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)), true);
        } else if (!editing && e.key.length === 1 && /[-0-9.]/.test(e.key)) {
          setText('');
          setEditing(true);
        }
      }}
    />
  );
}

/** Keyframe diamond: shows whether a value is animated / keyed here; click to add or remove a key. */
export function KeyButton({ path }: { path: string }) {
  // Select only what changes the button, so it does not re-render every frame during playback.
  const animated = useApp((s) => (s.scene.timeline.tracks[path]?.length ?? 0) > 0);
  const hereId = useApp((s) => keyAt(s.scene.timeline.tracks[path], s.time)?.id);
  const here = useApp.getState().scene.timeline.tracks[path]?.find((k) => k.id === hereId);
  const hint = here
    ? 'Remove keyframe at the playhead'
    : animated
      ? 'Add a keyframe at the playhead (value is animated)'
      : 'Keyframe this value at the playhead';
  const hintProps = useHint(hint);
  return (
    <button
      className={`key-btn${animated ? ' animated' : ''}${here ? ' on' : ''}`}
      aria-pressed={!!here}
      onClick={() => {
        const app = useApp.getState();
        if (here) {
          app.setScene((s) => {
            const next = removeKey(s, path, here.id);
            // Removing the last key leaves the value where it was instead of jumping back.
            return next.timeline.tracks[path] ? next : writePath(next, path, here.v);
          });
        } else {
          app.addKey(path);
        }
      }}
      {...hintProps}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" fill={here ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2.4} />
      </svg>
    </button>
  );
}

/** Slider + number + keyframe button for a keyframable path. */
export function ValueSlider({
  path,
  min,
  max,
  step,
  digits = 2,
  suffix = '',
  label,
  color,
  hardMin,
  hardMax,
}: {
  path: string;
  min: number;
  max: number;
  step: number;
  digits?: number;
  suffix?: string;
  label: string;
  color?: string;
  hardMin?: number;
  hardMax?: number;
}) {
  const value = useValue(path) ?? 0;
  const id = useId();
  const pct = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  const edit = (v: number) => useApp.getState().editValue(path, v);
  return (
    <div className="value-row">
      <input
        id={id}
        className="slider"
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        style={{ ['--pct' as string]: `${pct}%`, ...(color ? { ['--track-fill' as string]: color } : {}) }}
        onChange={(e) => edit(Number(e.target.value))}
      />
      <NumberField
        label={label}
        value={value}
        step={step}
        digits={digits}
        suffix={suffix}
        min={hardMin}
        max={hardMax}
        onChange={(v) => edit(v)}
      />
      <KeyButton path={path} />
    </div>
  );
}

/** Read a value without subscribing (for event handlers). */
export function peekValue(path: string): number | undefined {
  const { scene, time } = useApp.getState();
  return currentValue(scene, time, path);
}

export function IconButton({
  icon,
  hint,
  onClick,
  className = 'btn ghost icon',
  active,
  disabled,
  size,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  hint: string;
  onClick: () => void;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  size?: number;
}) {
  const hintProps = useHint(hint);
  return (
    <button className={`${className}${active ? ' active' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={active} {...hintProps}>
      <Icon name={icon} size={size} />
    </button>
  );
}
