/** Right panel: slice offsets, info about the selected shape and its current slice, view settings. */
import { useMemo } from 'react';
import { axisName, hiddenCount, sliceDim } from '../math/axes';
import { compileJS } from '../math/sdf';
import type { FrameData, ObjectFrame } from '../scene/frame';
import { paths, type ShadingMode, type ViewSettings } from '../scene/model';
import { useApp, useValue } from '../scene/store';
import { describeSlice } from '../shapes/classify';
import { sdfValues } from '../shapes/registry';
import type { SdfShapeDef } from '../shapes/types';
import { Segmented, Switch, Term, ValueSlider } from './controls';
import { useFrame } from './hooks';
import { AxisLabel } from './TransformStack';
import { objectName } from './ScenePanel';

function sliceRange(frame: FrameData | null, j: number): number {
  if (!frame) return 3;
  let r = 2;
  for (const o of frame.objects) r = Math.max(r, Math.abs(o.center[frame.k + j] ?? 0) + o.radius);
  return Math.ceil(r * 2 + 0.25) / 2;
}

/** A value that follows the playhead (animated slice offsets included). */
function LiveValue({ path, digits = 2 }: { path: string; digits?: number }) {
  const v = useValue(path);
  return <>{v === undefined ? '–' : v.toFixed(digits)}</>;
}

function SliceSection() {
  const n = useApp((s) => s.scene.dim);
  const slice = useApp((s) => s.scene.slice);
  const setScene = useApp((s) => s.setScene);
  const frame = useFrame(400);
  const k = sliceDim(n);
  const h = hiddenCount(n);
  const world = k === 3 ? 'our 3D world' : 'Flatland';
  return (
    <div className="section">
      <div className="section-title">
        <Term k="slice">Slice</Term>
        <span className="grow" />
        {slice.some((v) => v !== 0) && (
          <button
            className="btn ghost small"
            onClick={() =>
              setScene((s) => ({
                ...s,
                slice: s.slice.map(() => 0),
                timeline: {
                  ...s.timeline,
                  tracks: Object.fromEntries(Object.entries(s.timeline.tracks).filter(([p]) => !p.startsWith('slice.'))),
                },
              }))
            }
          >
            Reset
          </button>
        )}
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        {world[0].toUpperCase() + world.slice(1)} is the <Term k="hyperplane">{k === 3 ? 'hyperplane' : 'plane'}</Term> where{' '}
        {Array.from({ length: h }, (_, j) => (
          <span key={j}>
            {j > 0 && (j === h - 1 ? ' and ' : ', ')}
            <AxisLabel axis={k + j} /> = <LiveValue path={paths.slice(j)} />
          </span>
        ))}
        . Slide the <Term k="sliceOffset">offset</Term> to scan through the shape.
      </p>
      {Array.from({ length: h }, (_, j) => {
        const R = sliceRange(frame, j);
        return (
          <div key={j} style={{ marginTop: j ? 8 : 0 }}>
            <div className="label" style={{ color: 'var(--text-2)', marginBottom: 2 }}>
              <AxisLabel axis={k + j} /> offset
            </div>
            <ValueSlider
              path={paths.slice(j)}
              label={`${axisName(k + j)} slice offset`}
              min={-R}
              max={R}
              step={0.01}
              color={`var(--${axisName(k + j)})`}
            />
          </div>
        );
      })}
    </div>
  );
}

const probeCache = new Map<string, ReturnType<typeof compileJS>>();

/** Whether a curved shape actually shows up in the slice (sampled on a coarse grid). */
function curvedSliceNonEmpty(o: ObjectFrame): boolean {
  const ball = o.sliceBall;
  if (!ball || o.def.kind !== 'sdf') return false;
  const def = o.def as SdfShapeDef;
  const key = `${def.id}|${o.n}|${JSON.stringify(o.obj.options)}`;
  let f = probeCache.get(key);
  if (!f) {
    f = compileJS(def.sdf(o.n, o.obj.options));
    probeCache.set(key, f);
  }
  const vals = sdfValues(def, o.obj.params);
  const steps = o.k === 3 ? 14 : 40;
  const p = new Array(o.n).fill(0);
  const q = new Array(o.k).fill(0);
  const cell = (2 * ball.radius) / steps;
  const total = o.k === 3 ? steps ** 3 : steps ** 2;
  for (let idx = 0; idx < total; idx++) {
    let r = idx;
    for (let d = 0; d < o.k; d++) {
      q[d] = ball.center[d] - ball.radius + ((r % steps) + 0.5) * cell;
      r = Math.floor(r / steps);
    }
    for (let i = 0; i < o.n; i++) {
      let s = o.t0[i];
      for (let d = 0; d < o.k; d++) s += o.L[i][d] * q[d];
      p[i] = s;
    }
    if (f(p, vals) * o.stretch[0] < cell * 0.5) return true;
  }
  return false;
}

function SliceCard({ o }: { o: ObjectFrame }) {
  const k = o.k;
  const info = useMemo(() => {
    if (!o.obj.visible) return { empty: true, name: 'Hidden', sub: 'This object is switched off.' };
    if (o.polytope) {
      const s = o.polytope.slice;
      if (!s)
        return {
          empty: true,
          name: 'Nothing here',
          sub: `The slice misses it entirely. Try moving the slice offset${k === 3 ? ' or rotating into w' : ''}.`,
        };
      if (!s.exact) return { empty: false, name: 'Slice', sub: `${s.planes.length} faces` };
      const d = describeSlice(s);
      const counts =
        k === 3
          ? `${d.counts.vertices} vertices · ${d.counts.edges} edges · ${d.counts.faces} faces`
          : `${d.counts.vertices} vertices · ${d.counts.edges} sides`;
      return { empty: false, name: d.name, sub: k === 3 ? `${counts}${d.detail ? ` (${d.detail})` : ''}` : counts };
    }
    if (o.def.kind === 'surface') {
      const sf = o.surface;
      if (!sf || sf.segments.length === 0)
        return { empty: true, name: 'Nothing here', sub: 'The slice misses this surface. Try moving the slice offset.' };
      return {
        empty: false,
        name: sf.loops === 1 ? 'One closed tube' : `${sf.loops} separate tubes`,
        sub: `The surface crosses our world along ${sf.loops === 1 ? 'a single curve' : `${sf.loops} curves`}; the thin solid around it shows up as a tube.`,
      };
    }
    if (!curvedSliceNonEmpty(o))
      return { empty: true, name: 'Nothing here', sub: 'The slice misses this shape. Try moving the slice offset.' };
    if (o.def.id === 'ball' && Math.abs(o.stretch[1] - o.stretch[0]) < 1e-9) {
      // A ball of radius r cut at distance d from its centre: radius sqrt(r^2 - d^2).
      const r = (o.obj.params.r ?? 1) * o.stretch[0];
      const rho = o.sliceBall?.radius ?? 0;
      const d = Math.sqrt(Math.max(0, r * r - rho * rho));
      return {
        empty: false,
        name: k === 3 ? 'Sphere' : 'Circle',
        sub: `radius ${rho.toFixed(2)} = √(${r.toFixed(2)}² − ${d.toFixed(2)}²)`,
      };
    }
    return {
      empty: false,
      name: 'Curved slice',
      sub: k === 3 ? 'A smooth 3D surface: drag to look around it.' : 'A smooth curve in Flatland.',
    };
  }, [o, k]);
  return (
    <div className={`slice-card${info.empty ? ' empty' : ''}`}>
      <div className="what">What you see in the slice</div>
      <div className="name">{info.name}</div>
      <div className="sub">{info.sub}</div>
    </div>
  );
}

function InfoSection() {
  const scene = useApp((s) => s.scene);
  const selectedId = useApp((s) => s.selectedId);
  const frame = useFrame(150);
  const obj = scene.objects.find((o) => o.id === selectedId) ?? scene.objects[0];
  const of = frame?.objects.find((o) => o.obj.id === obj?.id);
  if (!obj || !of) return null;
  const info = of.def.info(scene.dim, obj.options);
  return (
    <div className="section">
      <div className="section-title">About</div>
      <SliceCard o={of} />
      <div style={{ marginTop: 12 }} className="info-name">
        {objectName(obj, scene.dim)}
        {info.symbol && (
          <span className="symbol">
            <Term k="schlafli">{info.symbol}</Term>
          </span>
        )}
      </div>
      {info.counts && (
        <div className="counts">
          {info.counts.map((c) => (
            <div className="count" key={c.label}>
              <div className="n">{c.value}</div>
              <div className="l">{c.label === 'Cells' ? <Term k="cell">Cells</Term> : c.label}</div>
            </div>
          ))}
        </div>
      )}
      <div className="desc" style={{ marginTop: info.counts ? 0 : 8 }}>
        {info.description}
      </div>
      {info.funFact && (
        <div className="fun">
          <b>Did you know?</b> {info.funFact}
        </div>
      )}
    </div>
  );
}

const SHADING: { value: ShadingMode; label: string; hint: string }[] = [
  { value: 'solid', label: 'Solid', hint: 'One colour per object' },
  { value: 'cells', label: 'Cells', hint: 'Colour each face by the 4D cell it was cut from' },
  { value: 'tilt', label: '4D tilt', hint: 'Colour by how the surface leans into the hidden direction' },
  { value: 'depth', label: 'Depth', hint: 'Colour by position along the hidden axis inside the shape' },
];

function ViewSection() {
  const view = useApp((s) => s.scene.view);
  const k = useApp((s) => sliceDim(s.scene.dim));
  const setScene = useApp((s) => s.setScene);
  const setView = (patch: Partial<ViewSettings>) => setScene((s) => ({ ...s, view: { ...s.view, ...patch } }));
  const shadingKey =
    view.shading === 'cells' ? 'cellShading' : view.shading === 'tilt' ? 'shading4d' : view.shading === 'depth' ? 'depthShading' : null;
  return (
    <div className="section">
      <div className="section-title">View</div>
      <Segmented full label="Shading" value={view.shading} options={SHADING} onChange={(v) => setView({ shading: v })} />
      <p className="hint" style={{ marginBottom: 10 }}>
        {shadingKey ? <Term k={shadingKey} /> : 'Plain colours, lit like an ordinary 3D object.'}
      </p>
      <Switch checked={view.edges} onChange={(v) => setView({ edges: v })}>
        Edges
      </Switch>
      {k === 3 && (
        <>
          <Switch checked={view.hiddenEdges} onChange={(v) => setView({ hiddenEdges: v })}>
            X-ray edges (back side)
          </Switch>
          <Switch checked={view.floor} onChange={(v) => setView({ floor: v })}>
            Floor grid
          </Switch>
          <Switch checked={view.shadows} onChange={(v) => setView({ shadows: v })}>
            Shadows
          </Switch>
        </>
      )}
      <Switch checked={view.ghost.visible} onChange={(v) => setView({ ghost: { ...view.ghost, visible: v } })}>
        Context view (whole shape)
      </Switch>
    </div>
  );
}

export function InspectorPanel() {
  return (
    <>
      <SliceSection />
      <InfoSection />
      <ViewSection />
    </>
  );
}
