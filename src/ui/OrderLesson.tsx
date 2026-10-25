/**
 * "Order matters": two copies of a shape with the same two rotations. Press
 * "Swap order on B" to reverse B's order and see whether anything changes.
 */
import { axisName, parsePlane, planeName, planesShareAxis, type Plane } from '../math/axes';
import { linearPart } from '../math/homogeneous';
import { maxAbsDiff } from '../math/mat';
import { composeStack, type TransformOpSpec } from '../math/transforms';
import { editValue, resolveScene } from '../scene/animation';
import { defaultView, opSpec, paths, type Scene, type TransformOp } from '../scene/model';
import { useApp, useValue } from '../scene/store';
import { defaultOptions, defaultParams, getShape } from '../shapes/registry';
import { IconButton, NumberField, PopButton, Term } from './controls';
import { Icon } from './icons';
import { PlaneLabel, PlanePicker } from './TransformStack';
import { useUi } from './uiStore';

const A = 'lessonA';
const B = 'lessonB';
const SPREAD = 2.7;

function rotOp(id: string, plane: Plane, value: number): TransformOp {
  return { id, kind: 'rotate', enabled: true, plane, axis: 0, value };
}

export function lessonScene(p1: Plane, p2: Plane, a1 = 40, a2 = 55, dim = 4): Scene {
  const def = getShape('hypercube');
  const mk = (id: string, label: string, color: string, x: number) => ({
    id,
    shape: 'hypercube',
    params: { ...defaultParams(def), size: 1.7 },
    options: defaultOptions(def),
    ops: [
      rotOp('r1', p1, a1),
      rotOp('r2', p2, a2),
      { id: 'tx', kind: 'translate' as const, enabled: true, plane: [0, 1] as Plane, axis: 0, value: x },
    ],
    color,
    visible: true,
    label,
  });
  return {
    version: 1,
    title: 'Order matters',
    dim,
    slice: new Array(dim - 3).fill(0),
    objects: [mk(A, 'A', '#f2a65a', -SPREAD), mk(B, 'B', '#6cc3d5', SPREAD)],
    view: { ...defaultView(), shading: 'solid', ghost: { ...defaultView().ghost, visible: false } },
    timeline: { duration: 8, loop: true, tracks: {} },
    camera: { yaw: 0, pitch: 0.28, distance: 12.5, target: [0, -0.2, 0] },
  };
}

/** Angle control that sets the same rotation on both copies. */
function LinkedAngle({ opId, label }: { opId: string; label: string }) {
  const value = useValue(paths.op(A, opId)) ?? 0;
  const set = (v: number) => {
    const { time, setScene } = useApp.getState();
    setScene((s) => editValue(editValue(s, paths.op(A, opId), time, v), paths.op(B, opId), time, v), { coalesce: `lesson:${opId}` });
  };
  const pct = ((Math.max(-180, Math.min(180, value)) + 180) / 360) * 100;
  return (
    <div className="value-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 62px' }}>
      <input
        className="slider"
        type="range"
        aria-label={label}
        min={-180}
        max={180}
        step={1}
        value={Math.max(-180, Math.min(180, value))}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => set(Number(e.target.value))}
      />
      <NumberField label={label} value={value} step={1} digits={0} suffix="°" onChange={set} />
    </div>
  );
}

function sharedAxis(p: Plane, q: Plane): string {
  const s = p.find((a) => q.includes(a));
  return s === undefined ? '?' : axisName(s);
}

export function OrderLesson() {
  const scene = useApp((s) => s.scene);
  const time = useApp((s) => s.time);
  const setScene = useApp((s) => s.setScene);
  const close = () => useUi.getState().setLesson(null);
  const a = scene.objects.find((o) => o.id === A);
  const b = scene.objects.find((o) => o.id === B);
  const r1 = a?.ops.find((o) => o.id === 'r1');
  const r2 = a?.ops.find((o) => o.id === 'r2');

  if (!a || !b || !r1 || !r2) {
    return (
      <div className="lesson" role="dialog" aria-label="Order matters lesson">
        <div className="row">
          <h3>Order matters?</h3>
          <IconButton icon="close" hint="Close" className="btn ghost small icon" onClick={close} />
        </div>
        <p className="hint">
          Doing the same two rotations in a different order can give a different result. This lesson puts two copies side by side so you can
          test it.
        </p>
        <button
          className="btn primary"
          style={{ marginTop: 10 }}
          onClick={() => useApp.getState().loadScene(lessonScene(parsePlane('xy'), parsePlane('yz'), 40, 55, Math.max(4, scene.dim)))}
        >
          Start the lesson
        </button>
      </div>
    );
  }

  const n = scene.dim;
  const resolved = resolveScene(scene, time);
  const rotationsOf = (id: string): TransformOpSpec[] =>
    (resolved.objects.find((o) => o.id === id)?.ops ?? [])
      .filter((o) => o.kind === 'rotate')
      .map(opSpec)
      .filter((o): o is TransformOpSpec => o !== null);
  const diff = maxAbsDiff(linearPart(composeStack(n, rotationsOf(A)).matrix), linearPart(composeStack(n, rotationsOf(B)).matrix));
  const same = diff < 1e-6;
  const swapped = b.ops.find((o) => o.kind === 'rotate')?.id === 'r2';
  const share = planesShareAxis(r1.plane, r2.plane);

  const setPlane = (which: 'r1' | 'r2', plane: Plane) =>
    setScene((s) => ({
      ...s,
      objects: s.objects.map((o) =>
        o.id === A || o.id === B ? { ...o, ops: o.ops.map((op) => (op.id === which ? { ...op, plane } : op)) } : o,
      ),
    }));
  const swap = () =>
    setScene((s) => ({
      ...s,
      objects: s.objects.map((o) => {
        if (o.id !== B) return o;
        const rots = o.ops.filter((op) => op.kind === 'rotate').reverse();
        return { ...o, ops: [...rots, ...o.ops.filter((op) => op.kind !== 'rotate')] };
      }),
    }));
  const pick = (p: string, q: string) =>
    setScene((s) => ({
      ...s,
      objects: s.objects.map((o) =>
        o.id === A || o.id === B
          ? {
              ...o,
              ops: o.ops.map((op) =>
                op.id === 'r1' ? { ...op, plane: parsePlane(p) } : op.id === 'r2' ? { ...op, plane: parsePlane(q) } : op,
              ),
            }
          : o,
      ),
    }));
  const order = (x: TransformOp, y: TransformOp) => `${planeName(x.plane)} then ${planeName(y.plane)}`;

  return (
    <div className="lesson" role="dialog" aria-label="Order matters lesson">
      <div className="row">
        <h3>Order matters?</h3>
        <IconButton icon="close" hint="Close the lesson" className="btn ghost small icon" onClick={close} />
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        <b>A</b> rotates {order(r1, r2)}. <b>B</b> rotates {swapped ? order(r2, r1) : order(r1, r2)}.
      </p>
      {(['r1', 'r2'] as const).map((id, i) => {
        const op = id === 'r1' ? r1 : r2;
        return (
          <div key={id} style={{ marginTop: 8 }}>
            <div className="row">
              <span className="label">{i === 0 ? 'Rotation 1' : 'Rotation 2'}</span>
              <PopButton className="plane-btn" label={<PlaneLabel plane={op.plane} />} hint="Choose the rotation plane">
                {(c) => (
                  <PlanePicker
                    n={n}
                    value={op.plane}
                    onPick={(p) => {
                      setPlane(id, p);
                      c();
                    }}
                  />
                )}
              </PopButton>
            </div>
            <LinkedAngle opId={id} label={`Rotation ${i + 1} angle`} />
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={swap}>
          <Icon name="swap" size={14} /> Swap order on B
        </button>
        <button className="btn small" onClick={() => pick('xy', 'zw')} title="These planes share no axis">
          Try xy &amp; zw
        </button>
        <button className="btn small" onClick={() => pick('xy', 'yz')} title="These planes share the y axis">
          Try xy &amp; yz
        </button>
      </div>
      <div className={`verdict ${!swapped || same ? 'same' : 'diff'}`} role="status">
        {!swapped
          ? 'Same order on both, so A and B are identical. Now press “Swap order on B”.'
          : same
            ? `No change: ${planeName(r1.plane)} and ${planeName(r2.plane)} ${share ? 'happen to agree at these angles' : 'share no axis, so they commute'}.`
            : `Different! ${planeName(r1.plane)} and ${planeName(r2.plane)} share the ${sharedAxis(r1.plane, r2.plane)} axis, so the order changes the result.`}
      </div>
      <p className="hint">
        Rotations in planes with no common axis <Term k="commute">commute</Term>. In 4D two planes can be completely perpendicular (xy and
        zw), which has no 3D counterpart.
      </p>
    </div>
  );
}
