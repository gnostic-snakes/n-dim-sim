/**
 * Timeline: transport controls, a ruler with a draggable playhead, and one row
 * per animated value with its keyframes (drag to retime, click to select).
 */
import { useEffect, useRef, useState } from 'react';
import { axisName, sliceDim } from '../math/axes';
import { EASINGS, evaluateTrack, removeKey, removeTrack, setKey, updateKey } from '../scene/animation';
import { parsePath, UNIFORM, writePath, type Easing, type Scene } from '../scene/model';
import { useApp } from '../scene/store';
import { getShape } from '../shapes/registry';
import { IconButton, NumberField, Segmented, Term } from './controls';
import { Icon } from './icons';
import { objectName } from './ScenePanel';
import { useUi } from './uiStore';

export function pathLabel(scene: Scene, path: string): string {
  const p = parsePath(path);
  if (!p) return path;
  if (p.kind === 'slice') return `Slice · ${axisName(sliceDim(scene.dim) + p.index)} offset`;
  const obj = scene.objects.find((o) => o.id === p.objId);
  if (!obj) return path;
  const name = scene.objects.length > 1 ? `${objectName(obj, scene.dim)} · ` : '';
  if (p.kind === 'param') {
    const def = getShape(obj.shape);
    return `${name}${def.params.find((q) => q.key === p.key)?.label ?? p.key}`;
  }
  const op = obj.ops.find((o) => o.id === p.opId);
  if (!op) return path;
  const idx = obj.ops.indexOf(op) + 1;
  if (op.kind === 'rotate') return `${name}${idx}. Rotate ${axisName(op.plane[0])}${axisName(op.plane[1])}`;
  if (op.kind === 'translate') return `${name}${idx}. Translate ${axisName(op.axis)}`;
  return `${name}${idx}. Scale ${op.axis === UNIFORM ? 'all' : axisName(op.axis)}`;
}

/** Horizontal padding (px) so keyframes at t = 0 and t = end are fully visible and easy to grab. */
const PAD = 12;
const xOf = (t: number, duration: number, width: number) => PAD + (t / duration) * Math.max(1, width - 2 * PAD);

function tickStep(duration: number, width: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  for (const s of steps) if ((s / duration) * (width - 2 * PAD) >= 70) return s;
  return steps[steps.length - 1];
}

function TimeDisplay() {
  const time = useApp((s) => s.time);
  const duration = useApp((s) => s.scene.timeline.duration);
  return (
    <span className="time" aria-live="off">
      <b>{time.toFixed(2)}</b> / {duration.toFixed(2)} s
    </span>
  );
}

function Playhead({ width }: { width: number }) {
  const time = useApp((s) => s.time);
  const duration = useApp((s) => s.scene.timeline.duration);
  return <div className="playhead" style={{ left: xOf(time, duration, width) }} />;
}

interface Selected {
  path: string;
  id: string;
}

function KeyEditor({ sel, onClear }: { sel: Selected; onClear: () => void }) {
  const scene = useApp((s) => s.scene);
  const setScene = useApp((s) => s.setScene);
  const key = scene.timeline.tracks[sel.path]?.find((k) => k.id === sel.id);
  if (!key) return null;
  return (
    <>
      <span className="hide-mobile" style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>
        Key at
      </span>
      <div style={{ width: 64 }}>
        <NumberField
          label="Keyframe time"
          value={key.t}
          step={0.05}
          digits={2}
          suffix="s"
          min={0}
          max={scene.timeline.duration}
          onChange={(t) => setScene((s) => updateKey(s, sel.path, sel.id, { t }), { coalesce: `kt:${sel.id}` })}
        />
      </div>
      <div style={{ width: 70 }}>
        <NumberField
          label="Keyframe value"
          value={key.v}
          step={0.01}
          digits={2}
          onChange={(v) => setScene((s) => updateKey(s, sel.path, sel.id, { v }), { coalesce: `kv:${sel.id}` })}
        />
      </div>
      <select
        className="select"
        style={{ flex: 'none', height: 26, fontSize: 12 }}
        aria-label="Easing from this keyframe"
        value={key.ease}
        onChange={(e) => setScene((s) => updateKey(s, sel.path, sel.id, { ease: e.target.value as Easing }))}
      >
        {EASINGS.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>
      <IconButton
        icon="trash"
        hint="Delete keyframe"
        className="btn ghost small icon"
        size={14}
        onClick={() => {
          setScene((s) => removeKey(s, sel.path, sel.id));
          onClear();
        }}
      />
    </>
  );
}

export function Timeline() {
  const scene = useApp((s) => s.scene);
  const playing = useApp((s) => s.playing);
  const speed = useApp((s) => s.speed);
  const open = useUi((s) => s.timelineOpen);
  const setScene = useApp((s) => s.setScene);
  const { duration, loop, tracks } = scene.timeline;
  const areaRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [sel, setSel] = useState<Selected | null>(null);
  const paths = Object.keys(tracks);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(50, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (sel && !tracks[sel.path]?.some((k) => k.id === sel.id)) setSel(null);
  }, [sel, tracks]);

  // Delete selected keyframe with the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        useApp.getState().setScene((s) => removeKey(s, sel.path, sel.id));
        setSel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const timeAt = (clientX: number) => {
    const r = areaRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left - PAD) / Math.max(1, r.width - 2 * PAD)) * duration));
  };

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const app = useApp.getState();
    app.setPlaying(false);
    app.setTime(timeAt(e.clientX));
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => useApp.getState().setTime(timeAt(ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const dragKey = (e: React.PointerEvent, path: string, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSel({ path, id });
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      moved = true;
      let t = timeAt(ev.clientX);
      const step = ev.shiftKey ? 0.01 : 0.05;
      t = Math.round(t / step) * step;
      useApp.getState().setScene((s) => updateKey(s, path, id, { t }), { coalesce: `drag:${id}` });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (!moved) {
        const k = useApp.getState().scene.timeline.tracks[path]?.find((x) => x.id === id);
        if (k) useApp.getState().setTime(k.t);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const step = tickStep(duration, width);
  const ticks: { t: number; major: boolean }[] = [];
  for (let t = 0; t <= duration + 1e-9; t += step / 2) {
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ticks.push({ t, major });
  }

  return (
    <section className={`timeline${open ? '' : ' collapsed'}`} aria-label="Timeline">
      <div className="transport">
        <IconButton icon="start" hint="Go to start (Home)" onClick={() => useApp.getState().setTime(0)} />
        <button
          className="btn primary icon"
          onClick={() => {
            const app = useApp.getState();
            if (!app.playing && app.time >= duration - 1e-6 && !loop) app.setTime(0);
            app.setPlaying(!app.playing);
          }}
          aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <IconButton
          icon="loop"
          hint={loop ? 'Looping (click to play once)' : 'Play once (click to loop)'}
          active={loop}
          onClick={() => setScene((s) => ({ ...s, timeline: { ...s.timeline, loop: !s.timeline.loop } }))}
        />
        <TimeDisplay />
        <span className="grow" />
        {sel ? (
          <KeyEditor sel={sel} onClear={() => setSel(null)} />
        ) : (
          <>
            <label className="hide-mobile">
              Length
              <NumberField
                label="Animation length in seconds"
                value={duration}
                step={0.5}
                digits={1}
                suffix="s"
                min={0.5}
                max={600}
                onChange={(d) =>
                  setScene(
                    (s) => ({
                      ...s,
                      timeline: { ...s.timeline, duration: d },
                    }),
                    { coalesce: 'duration' },
                  )
                }
              />
            </label>
            <span className="hide-mobile">
              <Segmented
                label="Playback speed"
                value={speed}
                onChange={(v) => useApp.getState().setSpeed(v)}
                options={[0.25, 0.5, 1, 2].map((v) => ({ value: v, label: `${v}×` }))}
              />
            </span>
          </>
        )}
        <IconButton
          icon={open ? 'chevronDown' : 'chevronUp'}
          hint={open ? 'Hide keyframes' : 'Show keyframes'}
          onClick={() => useUi.getState().setTimelineOpen(!open)}
        />
      </div>
      {open && (
        <div className="tracks">
          <div className="track-labels">
            <div className="ruler" />
            {paths.map((p) => (
              <div className="track-label" key={p} title={pathLabel(scene, p)}>
                <Icon name="diamond" size={11} />
                <span className="t">{pathLabel(scene, p)}</span>
                <IconButton
                  icon="close"
                  hint="Stop animating this value"
                  className="btn ghost small icon"
                  size={12}
                  onClick={() =>
                    setScene((s) => {
                      // Keep the value it has right now as its new static value.
                      const v = evaluateTrack(s.timeline.tracks[p] ?? [], useApp.getState().time);
                      const next = removeTrack(s, p);
                      return v === undefined ? next : writePath(next, p, v);
                    })
                  }
                />
              </div>
            ))}
          </div>
          <div
            className="track-area"
            ref={areaRef}
            onPointerDown={scrub}
            onDoubleClick={(e) => {
              const row = (e.target as HTMLElement).closest<HTMLElement>('[data-path]');
              if (!row) return;
              const path = row.dataset.path!;
              const t = Math.round(timeAt(e.clientX) / 0.05) * 0.05;
              const v = evaluateTrack(useApp.getState().scene.timeline.tracks[path] ?? [], t);
              if (v !== undefined) setScene((s) => setKey(s, path, t, v));
            }}
          >
            <div className="ruler">
              {ticks.map(({ t, major }) => (
                <div key={t.toFixed(4)} className={`tick${major ? '' : ' minor'}`} style={{ left: xOf(t, duration, width) }}>
                  {major ? `${+t.toFixed(2)}s` : ''}
                </div>
              ))}
            </div>
            {paths.map((p) => {
              const keys = tracks[p];
              return (
                <div className="track-row" key={p} data-path={p}>
                  {keys.length > 1 && (
                    <div
                      className="seg-line"
                      style={{ left: xOf(keys[0].t, duration, width), width: xOf(keys[keys.length - 1].t, duration, width) - xOf(keys[0].t, duration, width) }}
                    />
                  )}
                  {keys.map((kf) => (
                    <div
                      key={kf.id}
                      className={`kf ease-${kf.ease}${sel?.id === kf.id ? ' selected' : ''}`}
                      style={{ left: xOf(kf.t, duration, width) }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Keyframe at ${kf.t.toFixed(2)} s, value ${kf.v.toFixed(2)}`}
                      onPointerDown={(e) => dragKey(e, p, kf.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setSel({ path: p, id: kf.id });
                      }}
                    />
                  ))}
                </div>
              );
            })}
            {paths.length === 0 && (
              <div className="tracks-empty">
                Nothing is animated yet. Click the <b>◆</b> next to any number to add a <Term k="keyframe">keyframe</Term> at the playhead,
                move the playhead, change the value, and press play. Or load a preset from the menu above.
              </div>
            )}
            <Playhead width={width} />
          </div>
        </div>
      )}
    </section>
  );
}
