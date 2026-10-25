/** The context inset: the whole shape projected, with the slice drawn inside it. */
import { useEffect, useRef } from 'react';
import { axisName, sliceDim } from '../math/axes';
import { GhostRenderer } from '../render/ghost';
import type { GhostMode } from '../scene/model';
import { useApp } from '../scene/store';
import { IconButton, Segmented, Term } from './controls';
import { engine } from './engine';
import { AxisLabel } from './TransformStack';

export function GhostView() {
  const ghost = useApp((s) => s.scene.view.ghost);
  const n = useApp((s) => s.scene.dim);
  const setScene = useApp((s) => s.setScene);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const own = useRef({ yaw: 0.65, pitch: 0.38 });
  const k = sliceDim(n);
  const flat = k === 2;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new GhostRenderer(canvas);
    let last = 0;
    let dirty = true;
    let lastCam = '';
    const draw = (force = false) => {
      const frame = engine.frame;
      if (!frame) return;
      const state = useApp.getState();
      const g = state.scene.view.ghost;
      const cam = g.sync ? engine.camera.orbit : own.current;
      const camKey = `${cam.yaw}|${cam.pitch}|${canvas.clientWidth}x${canvas.clientHeight}`;
      if (!force && !dirty && camKey === lastCam) return;
      const now = performance.now();
      if (!force && now - last < 33) return; // ~30 fps is plenty for the inset
      last = now;
      dirty = false;
      lastCam = camKey;
      r.draw(frame, { mode: g.mode, sideAxis: g.sideAxis, yaw: cam.yaw, pitch: cam.pitch, selectedId: state.selectedId });
    };
    const unsub = engine.subscribe((_f, changed) => {
      if (changed) dirty = true;
      draw();
    });
    const ro = new ResizeObserver(() => draw(true));
    ro.observe(canvas);

    // Dragging rotates the inset (and unlinks it from the main camera).
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY };
      const s = useApp.getState();
      if (s.scene.view.ghost.sync) {
        own.current = { yaw: engine.camera.orbit.yaw, pitch: engine.camera.orbit.pitch };
        s.setScene((sc) => ({ ...sc, view: { ...sc.view, ghost: { ...sc.view.ghost, sync: false } } }), { transient: true });
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      own.current.yaw -= (e.clientX - drag.x) * 0.01;
      own.current.pitch = Math.max(-1.5, Math.min(1.5, own.current.pitch + (e.clientY - drag.y) * 0.01));
      drag = { x: e.clientX, y: e.clientY };
      draw(true);
    };
    const up = () => {
      drag = null;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    return () => {
      unsub();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
  }, []);

  const setGhost = (patch: Partial<typeof ghost>) => setScene((s) => ({ ...s, view: { ...s.view, ghost: { ...s.view.ghost, ...patch } } }));
  const hiddenAxes = Array.from({ length: n - k }, (_, j) => k + j);
  const label = flat ? 'The whole 3D shape' : 'The whole shape';
  return (
    <div className="ghost-panel" aria-label="Context view of the whole shape">
      <div className="ghost-head">
        <span className="title">{label}</span>
        {!flat && (
          <Segmented<GhostMode>
            label="Projection"
            value={ghost.mode}
            onChange={(mode) => setGhost({ mode })}
            options={[
              { value: 'shadow', label: 'Shadow', hint: 'Drop the hidden axes: the slice sits at its true position inside the shadow' },
              { value: 'perspective', label: 'Persp.', hint: `Perspective from ${n}D: the classic nested-cube picture` },
              { value: 'side', label: 'Side', hint: 'Swap z for a hidden axis: the slicing hyperplane appears as a flat sheet' },
            ]}
          />
        )}
        <IconButton
          icon="close"
          hint="Hide the context view"
          className="btn ghost small icon"
          size={14}
          onClick={() => setGhost({ visible: false })}
        />
      </div>
      <div className="ghost-canvas">
        <canvas ref={canvasRef} />
        {!ghost.sync && (
          <IconButton
            icon="frame"
            hint="Follow the main camera again"
            className="btn ghost small icon ghost-sync"
            size={14}
            onClick={() => setGhost({ sync: true })}
          />
        )}
      </div>
      <div className="ghost-legend">
        {!flat && ghost.mode === 'side' && n > 4 && (
          <select
            className="select"
            style={{ flex: 'none', height: 22, fontSize: 11 }}
            value={ghost.sideAxis}
            aria-label="Hidden axis shown in side view"
            onChange={(e) => setGhost({ sideAxis: Number(e.target.value) })}
          >
            {hiddenAxes.map((a) => (
              <option key={a} value={a}>
                show {axisName(a)}
              </option>
            ))}
          </select>
        )}
        <span>
          −<AxisLabel axis={k} />
        </span>
        <span className="bar" />
        <span>
          +<AxisLabel axis={k} />
        </span>
        <span style={{ color: '#ffecc8' }}>
          ━ <Term k="slice">slice</Term>
        </span>
      </div>
    </div>
  );
}
