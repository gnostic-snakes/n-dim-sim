/** Things drawn over the main view: live slice name, object labels, axes gizmo, errors, toasts. */
import { useEffect, useRef, useState } from 'react';
import { axisName } from '../math/axes';
import { cameraBasis, DEFAULT_CAMERA } from '../render/camera';
import type { ObjectFrame } from '../scene/frame';
import { useApp } from '../scene/store';
import { describeSlice } from '../shapes/classify';
import type { SliceResult } from '../math/slice';
import { IconButton } from './controls';
import { engine } from './engine';
import { HOPF_CAMERA } from './TopBar';
import { useUi } from './uiStore';
import { useFrame } from './hooks';

const describeCache = new WeakMap<SliceResult, string>();
function sliceName(o: ObjectFrame): string | null {
  const s = o.polytope?.slice;
  if (!o.obj.visible) return null;
  if (o.def.kind === 'surface') {
    const loops = o.surface?.segments.length ? o.surface.loops : 0;
    return loops === 0 ? 'nothing' : loops === 1 ? 'one closed tube' : `${loops} tubes`;
  }
  if (o.polytope) {
    if (!s) return 'nothing';
    if (!s.exact) return null;
    let name = describeCache.get(s);
    if (!name) {
      name = describeSlice(s).name;
      describeCache.set(s, name);
    }
    return name;
  }
  return null;
}

/** Top-left chip: what the slice of the selected object currently is. */
export function SliceHud() {
  const frame = useFrame(100);
  const selectedId = useApp((s) => s.selectedId);
  if (!frame) return null;
  const n = frame.n;
  // The frame holds the scene resolved at the playhead, so animated offsets show live values.
  const slice = frame.scene.slice;
  const o = frame.objects.find((x) => x.obj.id === selectedId) ?? frame.objects[0];
  const name = o ? sliceName(o) : null;
  const k = frame.k;
  const offsets = slice.map((v, j) => `${axisName(k + j)} = ${v.toFixed(2)}`).join(', ');
  return (
    <div className="overlay hud">
      <div className="hud-chip">
        {name ? (
          <>
            Slice: <b>{name === 'nothing' ? 'empty' : name}</b>
          </>
        ) : (
          <>Slice</>
        )}
        <span style={{ color: 'var(--text-3)' }}>
          {' '}
          · {n === 3 ? 'Flatland' : `${n}D`} at {offsets}
        </span>
      </div>
    </div>
  );
}

/** A gentle hint in the middle of the view when the slice misses every object. */
export function EmptyHint() {
  const frame = useFrame(200);
  if (!frame || frame.objects.length === 0) return null;
  const anyVisible = frame.objects.some((o) => o.visible);
  const anyShown = frame.objects.some((o) => o.obj.visible);
  if (anyVisible || !anyShown) return null;
  const axis = axisName(frame.k);
  return (
    <div className="overlay empty-hint">
      <div className="hud-chip">
        Nothing here: our {frame.k === 3 ? '3D world' : 'Flatland'} misses the shape. Move the <b>{axis} offset</b> or rotate the shape into{' '}
        <b>{axis}</b>.
      </div>
    </div>
  );
}

/** Labels above objects when the scene has more than one. */
export function ObjectLabels() {
  const ref = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<{ id: string; text: string }[]>([]);
  const objects = useApp((s) => s.scene.objects);
  const flat = useApp((s) => s.scene.dim === 3);
  useEffect(() => {
    const next = objects.length > 1 ? objects.filter((o) => o.label).map((o) => ({ id: o.id, text: o.label! })) : [];
    setLabels(next);
  }, [objects]);
  useEffect(() => {
    if (labels.length === 0) return;
    return engine.subscribe((frame) => {
      const root = ref.current;
      if (!root) return;
      const w = root.clientWidth;
      const h = root.clientHeight;
      const b = cameraBasis(engine.camera.orbit);
      for (const el of root.querySelectorAll<HTMLElement>('[data-obj]')) {
        const o = frame.objects.find((x) => x.obj.id === el.dataset.obj);
        if (!o) continue;
        let sx: number;
        let sy: number;
        if (flat) {
          const c = engine.camera.flat;
          sx = w / 2 + (o.center[0] - c.center[0]) / c.unitsPerPx;
          sy = h / 2 - (o.center[1] + o.radius - c.center[1]) / c.unitsPerPx - 26;
        } else {
          const p = [o.center[0], o.center[1] + (o.sliceBall?.radius ?? o.radius) * 0.85 + 0.35, o.center[2]];
          const d = [p[0] - b.eye[0], p[1] - b.eye[1], p[2] - b.eye[2]];
          const z = d[0] * b.forward[0] + d[1] * b.forward[1] + d[2] * b.forward[2];
          if (z <= 0.01) {
            el.style.display = 'none';
            continue;
          }
          const x = (d[0] * b.right[0] + d[1] * b.right[1] + d[2] * b.right[2]) / z;
          const y = (d[0] * b.up[0] + d[1] * b.up[1] + d[2] * b.up[2]) / z;
          sx = w / 2 + (x / (b.tanHalfFov * (w / h))) * (w / 2);
          sy = h / 2 - (y / b.tanHalfFov) * (h / 2) - 26;
        }
        el.style.display = '';
        el.style.left = `${sx}px`;
        el.style.top = `${sy}px`;
      }
    });
  }, [labels, flat]);
  if (labels.length === 0) return null;
  return (
    <div className="obj-labels" ref={ref}>
      {labels.map((l) => (
        <div key={l.id} className="obj-label" data-obj={l.id}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** Orientation gizmo for the 3D view (x red, y green, z blue). */
export function AxesGizmo() {
  const ref = useRef<SVGSVGElement>(null);
  const flat = useApp((s) => s.scene.dim === 3);
  useEffect(() => {
    if (flat) return;
    return engine.subscribe(() => {
      const svg = ref.current;
      if (!svg) return;
      const b = cameraBasis(engine.camera.orbit);
      const axes = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const items = axes.map((a, i) => ({
        i,
        x: a[0] * b.right[0] + a[1] * b.right[1] + a[2] * b.right[2],
        y: a[0] * b.up[0] + a[1] * b.up[1] + a[2] * b.up[2],
        z: a[0] * b.forward[0] + a[1] * b.forward[1] + a[2] * b.forward[2],
      }));
      items.sort((p, q) => q.z - p.z);
      items.forEach((it) => {
        const g = svg.querySelector<SVGGElement>(`[data-axis="${it.i}"]`);
        if (!g) return;
        const ex = 37 + it.x * 24;
        const ey = 37 - it.y * 24;
        g.querySelector('line')!.setAttribute('x2', String(ex));
        g.querySelector('line')!.setAttribute('y2', String(ey));
        g.querySelector('circle')!.setAttribute('cx', String(ex));
        g.querySelector('circle')!.setAttribute('cy', String(ey));
        const t = g.querySelector('text')!;
        t.setAttribute('x', String(ex));
        t.setAttribute('y', String(ey + 3.5));
        g.style.opacity = it.z > 0.3 ? '0.55' : '1';
        svg.appendChild(g);
      });
    });
  }, [flat]);
  if (flat) return null;
  const colors = ['#ef6b62', '#6fcf6f', '#5c9cf5'];
  return (
    <svg ref={ref} className="overlay axes-gizmo" viewBox="0 0 74 74" aria-hidden>
      {colors.map((c, i) => (
        <g key={i} data-axis={i}>
          <line x1="37" y1="37" x2="37" y2="37" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="37" cy="37" r="7" fill={c} />
          <text x="37" y="37" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#0b0e15" fontFamily="ui-monospace, monospace">
            {'xyz'[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ErrorBanner() {
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      engine.subscribe(() => {
        setError((prev) => (prev === engine.error ? prev : engine.error));
      }),
    [],
  );
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      {error.includes('WebGL2') ? 'This browser or device does not support WebGL2, which Slice needs to draw the 3D view.' : error}
    </div>
  );
}

export function Toast() {
  const toast = useApp((s) => s.toast);
  const [visible, setVisible] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    setVisible(toast.text);
    const t = setTimeout(() => setVisible(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  if (!visible) return null;
  return (
    <div className="toast" role="status">
      {visible}
    </div>
  );
}

/** Small toolbar in the top-right corner of the main view. */
export function ViewTools() {
  const reset = () => {
    const app = useApp.getState();
    if (useUi.getState().special === 'hopf') {
      engine.camera.animateTo(HOPF_CAMERA);
      return;
    }
    engine.camera.animateTo(app.scene.camera ?? DEFAULT_CAMERA);
    engine.camera.flat = { center: [0, 0], unitsPerPx: 0.012 };
    engine.requestRender();
  };
  return (
    <div className="overlay view-tools">
      <IconButton icon="frame" hint="Reset the view (F)" className="btn icon" onClick={reset} />
    </div>
  );
}

const WELCOME_KEY = 'slice.welcomed.v1';

/** First-visit card with three things to try. */
export function Welcome() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) === null;
    } catch {
      return false;
    }
  });
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // best effort
    }
    setOpen(false);
  };
  return (
    <div className="overlay welcome" role="dialog" aria-label="Welcome">
      <div className="welcome-card">
        <div className="row">
          <b style={{ flex: 1 }}>Welcome to Slice</b>
          <IconButton icon="close" hint="Dismiss" className="btn ghost small icon" size={14} onClick={close} />
        </div>
        <p>
          You are watching a <b>tesseract</b> (a 4D cube) turn through our 3D world. What you see is its <b>slice</b>: the part that lies in
          our space, the way a Flatlander would see a passing sphere as a growing and shrinking circle.
        </p>
        <ol>
          <li>
            Drag the <b>w offset</b> slider (right) to scan through the shape.
          </li>
          <li>
            Add a <b>Rotate</b> step in the <b>xy</b> plane: it just spins the slice. Rotations that involve <b>w</b> make it morph.
          </li>
          <li>
            Open <b>Presets</b> for the classics, or try <b>Flatland</b> for the analogy one dimension down.
          </li>
        </ol>
        <button className="btn primary small" onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}
