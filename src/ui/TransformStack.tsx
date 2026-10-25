/**
 * The transform stack: an ordered, reorderable list of operations. Dragging a
 * row reorders the stack live, so the effect of order is visible while you drag.
 */
import { useRef, useState } from 'react';
import { axisName, isHiddenAxis, planeKind, sliceDim, type Plane } from '../math/axes';
import { removeTrack } from '../scene/animation';
import { makeOp, paths, UNIFORM, type OpKind, type SceneObject, type TransformOp } from '../scene/model';
import { useApp } from '../scene/store';
import { hideTip, IconButton, PopButton, Term, useHint, ValueSlider } from './controls';
import { Icon, type IconName } from './icons';

export function AxisLabel({ axis }: { axis: number }) {
  return <span className={`ax ax-${axis}`}>{axisName(axis)}</span>;
}

export function PlaneLabel({ plane }: { plane: Plane }) {
  return (
    <>
      <AxisLabel axis={plane[0]} />
      <AxisLabel axis={plane[1]} />
    </>
  );
}

const KIND_META: Record<OpKind, { label: string; icon: IconName }> = {
  rotate: { label: 'Rotate', icon: 'rotate' },
  translate: { label: 'Translate', icon: 'move' },
  scale: { label: 'Scale', icon: 'scale' },
};

/** Triangular grid of all rotation planes for dimension n. */
export function PlanePicker({ n, value, onPick }: { n: number; value?: Plane; onPick: (p: Plane) => void }) {
  const cols = n - 1;
  return (
    <div>
      <div className="plane-grid" style={{ gridTemplateColumns: `22px repeat(${cols}, auto)` }}>
        <span />
        {Array.from({ length: cols }, (_, j) => (
          <span key={j} className="head">
            <AxisLabel axis={j + 1} />
          </span>
        ))}
        {Array.from({ length: n - 1 }, (_, a) => (
          <PlaneRow key={a} a={a} n={n} value={value} onPick={onPick} />
        ))}
      </div>
      <div className="plane-legend">
        <span className="mixing">uses a hidden axis: the slice morphs</span>
        <span>both axes visible: the slice just spins</span>
        {n >= 5 && <span className="hidden-plane">both axes hidden</span>}
      </div>
    </div>
  );
}

function PlaneRow({ a, n, value, onPick }: { a: number; n: number; value?: Plane; onPick: (p: Plane) => void }) {
  return (
    <>
      <span className="head">
        <AxisLabel axis={a} />
      </span>
      {Array.from({ length: n - 1 }, (_, j) => {
        const b = j + 1;
        if (b <= a) return <span key={b} />;
        const kind = planeKind(n, [a, b]);
        const on = value && value[0] === a && value[1] === b;
        return (
          <button
            key={b}
            className={`${on ? 'on ' : ''}${kind === 'mixing' ? 'mixing' : kind === 'hidden' ? 'hidden-plane' : ''}`}
            onClick={() => onPick([a, b])}
            aria-label={`${axisName(a)}${axisName(b)} plane`}
            aria-pressed={!!on}
          >
            {axisName(a)}
            {axisName(b)}
          </button>
        );
      })}
    </>
  );
}

function AxisPicker({ n, value, uniform, onPick }: { n: number; value: number; uniform: boolean; onPick: (a: number) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 230 }}>
      {Array.from({ length: n }, (_, i) => (
        <button key={i} className={`axis-btn${value === i ? ' active' : ''}`} onClick={() => onPick(i)} aria-pressed={value === i}>
          <AxisLabel axis={i} />
        </button>
      ))}
      {uniform && (
        <button className={`axis-btn${value === UNIFORM ? ' active' : ''}`} onClick={() => onPick(UNIFORM)} aria-pressed={value === UNIFORM}>
          all
        </button>
      )}
    </div>
  );
}

function opTag(n: number, op: TransformOp): { cls: string; text: string } | null {
  if (op.kind === 'rotate') {
    const k = planeKind(n, op.plane);
    return k === 'mixing'
      ? { cls: 'mixing', text: 'morphs slice' }
      : k === 'visible'
        ? { cls: 'visible', text: 'spins slice' }
        : { cls: 'hidden', text: 'hidden plane' };
  }
  if (op.axis === UNIFORM) return null;
  if (isHiddenAxis(n, op.axis)) return { cls: 'mixing', text: op.kind === 'translate' ? 'moves through slice' : 'stretches in hidden axis' };
  return { cls: 'visible', text: op.kind === 'translate' ? 'moves slice' : 'stretches slice' };
}

function OpRow({
  obj,
  op,
  index,
  n,
  dragging,
  onGrip,
  onMove,
}: {
  obj: SceneObject;
  op: TransformOp;
  index: number;
  n: number;
  dragging: boolean;
  onGrip: (e: React.PointerEvent, index: number) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  const setScene = useApp((s) => s.setScene);
  const meta = KIND_META[op.kind];
  const path = paths.op(obj.id, op.id);
  const update = (patch: Partial<TransformOp>) =>
    setScene((s) => ({
      ...s,
      objects: s.objects.map((o) => (o.id === obj.id ? { ...o, ops: o.ops.map((x) => (x.id === op.id ? { ...x, ...patch } : x)) } : o)),
    }));
  const remove = () =>
    setScene((s) =>
      removeTrack(
        { ...s, objects: s.objects.map((o) => (o.id === obj.id ? { ...o, ops: o.ops.filter((x) => x.id !== op.id) } : o)) },
        path,
      ),
    );
  const tag = opTag(n, op);
  const gripHint = useHint('Drag to reorder (or focus and press Alt + ↑/↓)');
  const range =
    op.kind === 'rotate'
      ? { min: -360, max: 360, step: 1, digits: 0, suffix: '°' }
      : op.kind === 'translate'
        ? { min: -4, max: 4, step: 0.01, digits: 2, suffix: '' }
        : { min: 0.1, max: 3, step: 0.01, digits: 2, suffix: '×' };
  return (
    <div className={`op${dragging ? ' dragging' : ''}${op.enabled ? '' : ' disabled'}`} data-op-index={index}>
      <div
        className="op-grip"
        role="button"
        tabIndex={0}
        onPointerDown={(e) => onGrip(e, index)}
        onKeyDown={(e) => {
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            onMove(index, e.key === 'ArrowUp' ? -1 : 1);
          }
        }}
        {...gripHint}
      >
        <span className="op-index">{index + 1}</span>
        <Icon name="grip" size={14} />
      </div>
      <div className="op-head">
        <input
          type="checkbox"
          className="op-check"
          checked={op.enabled}
          aria-label={`${op.enabled ? 'Disable' : 'Enable'} ${meta.label.toLowerCase()} step ${index + 1}`}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        <span className="op-kind">
          <Icon name={meta.icon} size={14} />
          {meta.label}
        </span>
        {op.kind === 'rotate' ? (
          <PopButton
            className="plane-btn"
            hint="Choose the rotation plane"
            label={<PlaneLabel plane={op.plane} />}
            popClass=""
          >
            {(close) => (
              <PlanePicker
                n={n}
                value={op.plane}
                onPick={(p) => {
                  update({ plane: p });
                  close();
                }}
              />
            )}
          </PopButton>
        ) : (
          <PopButton
            className="axis-btn"
            hint={op.kind === 'translate' ? 'Choose the axis to move along' : 'Choose the axis to stretch (or all)'}
            label={op.axis === UNIFORM ? 'all' : <AxisLabel axis={op.axis} />}
          >
            {(close) => (
              <AxisPicker
                n={n}
                value={op.axis}
                uniform={op.kind === 'scale'}
                onPick={(a) => {
                  update({ axis: a });
                  close();
                }}
              />
            )}
          </PopButton>
        )}
        {tag && <span className={`op-tag ${tag.cls}`}>{tag.text}</span>}
        <span className="grow" />
        <IconButton icon="close" hint="Remove this step" className="btn ghost small icon" onClick={remove} size={14} />
      </div>
      <div>
        <ValueSlider
          path={path}
          label={`${meta.label} ${op.kind === 'rotate' ? axisName(op.plane[0]) + axisName(op.plane[1]) : op.axis === UNIFORM ? 'all axes' : axisName(op.axis)}`}
          {...range}
          hardMin={op.kind === 'scale' ? 0.01 : undefined}
        />
      </div>
    </div>
  );
}

export function TransformStack({ obj }: { obj: SceneObject }) {
  const n = useApp((s) => s.scene.dim);
  const setScene = useApp((s) => s.setScene);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const drag = useRef<{ id: string; grabOffset: number; startOrder: string[] } | null>(null);

  const reorder = (from: number, to: number, transient: boolean) => {
    if (from === to) return;
    setScene(
      (s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (o.id !== obj.id) return o;
          const ops = o.ops.slice();
          const [m] = ops.splice(from, 1);
          ops.splice(to, 0, m);
          return { ...o, ops };
        }),
      }),
      transient ? { transient: true } : undefined,
    );
  };

  const onGrip = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    hideTip();
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('.op') ?? [])];
    const row = rows[index];
    if (!row) return;
    const rect = row.getBoundingClientRect();
    drag.current = { id: obj.ops[index].id, grabOffset: e.clientY - rect.top, startOrder: obj.ops.map((o) => o.id) };
    setDragIndex(index);
    // Listen on window: React may move the row's DOM node while reordering, which can drop pointer capture.

    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || !listRef.current) return;
      const app = useApp.getState();
      const current = app.scene.objects.find((o) => o.id === obj.id);
      if (!current) return;
      const from = current.ops.findIndex((o) => o.id === d.id);
      const els = [...listRef.current.querySelectorAll<HTMLElement>('.op')];
      // Target slot: how many other rows have their midpoint above the pointer.
      let to = 0;
      els.forEach((el, i) => {
        if (i === from) return;
        const r = el.getBoundingClientRect();
        if (r.top + r.height / 2 < ev.clientY) to++;
      });
      if (to !== from) {
        reorder(from, to, true);
        setDragIndex(to);
      }
      // Keep the dragged row under the pointer, relative to its (new) layout slot.
      requestAnimationFrame(() => {
        const list = listRef.current;
        if (!list || !drag.current) return;
        const idx = useApp.getState().scene.objects.find((o) => o.id === obj.id)?.ops.findIndex((o) => o.id === d.id) ?? -1;
        const el = list.querySelectorAll<HTMLElement>('.op')[idx];
        if (!el) return;
        el.style.transform = '';
        const r = el.getBoundingClientRect();
        el.style.transform = `translateY(${ev.clientY - d.grabOffset - r.top}px)`;
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const d = drag.current;
      drag.current = null;
      listRef.current?.querySelectorAll<HTMLElement>('.op').forEach((el) => (el.style.transform = ''));
      setDragIndex(null);
      if (!d) return;
      // Record a single undo step for the whole drag.
      const app = useApp.getState();
      const finalOrder = app.scene.objects.find((o) => o.id === obj.id)?.ops.map((o) => o.id) ?? [];
      if (finalOrder.join() !== d.startOrder.join()) {
        const after = app.scene;
        const before = {
          ...after,
          objects: after.objects.map((o) =>
            o.id === obj.id ? { ...o, ops: d.startOrder.map((id) => o.ops.find((x) => x.id === id)!).filter(Boolean) } : o,
          ),
        };
        useApp.setState({ scene: before });
        app.setScene(after);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const add = (kind: OpKind) => {
    const k = sliceDim(n);
    const init: Partial<TransformOp> =
      kind === 'rotate'
        ? { plane: [0, k] as Plane }
        : kind === 'translate'
          ? { axis: k }
          : { axis: UNIFORM, value: 1 };
    setScene((s) => ({ ...s, objects: s.objects.map((o) => (o.id === obj.id ? { ...o, ops: [...o.ops, makeOp(kind, init)] } : o)) }));
  };

  return (
    <div>
      <div className="stack" ref={listRef}>
        {obj.ops.map((op, i) => (
          <OpRow
            key={op.id}
            obj={obj}
            op={op}
            index={i}
            n={n}
            dragging={dragIndex === i}
            onGrip={onGrip}
            onMove={(index, dir) => {
              const to = index + dir;
              if (to >= 0 && to < obj.ops.length) reorder(index, to, false);
            }}
          />
        ))}
        {obj.ops.length === 0 && <p className="hint">No transforms yet. Add a rotation to start exploring.</p>}
      </div>
      <div className="add-ops">
        <button className="btn small" onClick={() => add('rotate')}>
          <Icon name="rotate" size={14} /> Rotate
        </button>
        <button className="btn small" onClick={() => add('translate')}>
          <Icon name="move" size={14} /> Translate
        </button>
        <button className="btn small" onClick={() => add('scale')}>
          <Icon name="scale" size={14} /> Scale
        </button>
      </div>
      <p className="hint">
        Steps run top to bottom, each measured against the fixed world axes. Rotations happen in a{' '}
        <Term k="rotationPlane">plane</Term>, not around an axis. Drag to reorder: in higher dimensions, <Term k="commute">order matters</Term>.
      </p>
    </div>
  );
}
