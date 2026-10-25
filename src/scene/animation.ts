/**
 * Keyframe animation. Every keyframable number has a path (see model.ts); a
 * track is a time-sorted list of keyframes for one path. A keyframe's easing
 * shapes the segment that starts at that keyframe.
 */
import { newId, parsePath, writePath, type Easing, type Keyframe, type Scene } from './model';

export const EASINGS: { id: Easing; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'ease', label: 'Ease in-out' },
  { id: 'ease-in', label: 'Ease in' },
  { id: 'ease-out', label: 'Ease out' },
  { id: 'hold', label: 'Hold (step)' },
];

export function ease(kind: Easing, u: number): number {
  const x = Math.min(1, Math.max(0, u));
  switch (kind) {
    case 'linear':
      return x;
    case 'ease':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case 'ease-in':
      return x * x * x;
    case 'ease-out':
      return 1 - (1 - x) ** 3;
    case 'hold':
      return x >= 1 ? 1 : 0;
  }
}

/** Value of a track at time t (clamped to the first/last keyframe outside their range). */
export function evaluateTrack(keys: readonly Keyframe[], t: number): number | undefined {
  if (keys.length === 0) return undefined;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  // Binary search for the segment [i, i+1] containing t.
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const span = b.t - a.t;
  const u = span > 0 ? (t - a.t) / span : 1;
  return a.v + (b.v - a.v) * ease(a.ease, u);
}

/** The scene with every animated value replaced by its value at time t. */
export function resolveScene(scene: Scene, t: number): Scene {
  let out = scene;
  for (const [path, keys] of Object.entries(scene.timeline.tracks)) {
    const v = evaluateTrack(keys, t);
    if (v !== undefined) out = writePath(out, path, v);
  }
  return out;
}

export function isAnimated(scene: Scene, path: string): boolean {
  return (scene.timeline.tracks[path]?.length ?? 0) > 0;
}

/** Keyframe at (approximately) time t, if any. */
export function keyAt(keys: readonly Keyframe[] | undefined, t: number, tol = 1e-3): Keyframe | undefined {
  return keys?.find((k) => Math.abs(k.t - t) < tol);
}

export function sortKeys(keys: Keyframe[]): Keyframe[] {
  return keys.slice().sort((a, b) => a.t - b.t);
}

/** Insert or update the keyframe at time t. */
export function setKey(scene: Scene, path: string, t: number, v: number, easing?: Easing): Scene {
  const keys = scene.timeline.tracks[path] ?? [];
  const existing = keyAt(keys, t);
  const next = existing
    ? keys.map((k) => (k === existing ? { ...k, v, ease: easing ?? k.ease } : k))
    : sortKeys([...keys, { id: newId('key'), t, v, ease: easing ?? 'ease' }]);
  return { ...scene, timeline: { ...scene.timeline, tracks: { ...scene.timeline.tracks, [path]: next } } };
}

export function removeKey(scene: Scene, path: string, keyId: string): Scene {
  const keys = (scene.timeline.tracks[path] ?? []).filter((k) => k.id !== keyId);
  const tracks = { ...scene.timeline.tracks };
  if (keys.length === 0) delete tracks[path];
  else tracks[path] = keys;
  return { ...scene, timeline: { ...scene.timeline, tracks } };
}

export function updateKey(scene: Scene, path: string, keyId: string, patch: Partial<Keyframe>): Scene {
  const keys = scene.timeline.tracks[path];
  if (!keys) return scene;
  const next = sortKeys(keys.map((k) => (k.id === keyId ? { ...k, ...patch } : k)));
  return { ...scene, timeline: { ...scene.timeline, tracks: { ...scene.timeline.tracks, [path]: next } } };
}

export function removeTrack(scene: Scene, path: string): Scene {
  const tracks = { ...scene.timeline.tracks };
  delete tracks[path];
  return { ...scene, timeline: { ...scene.timeline, tracks } };
}

/** Drop tracks whose target no longer exists (e.g. after deleting an op). */
export function pruneTracks(scene: Scene): Scene {
  const tracks: Scene['timeline']['tracks'] = {};
  let changed = false;
  for (const [path, keys] of Object.entries(scene.timeline.tracks)) {
    const p = parsePath(path);
    let ok = false;
    if (p?.kind === 'slice') ok = p.index < scene.slice.length;
    else if (p) {
      const obj = scene.objects.find((o) => o.id === p.objId);
      ok = !!obj && (p.kind === 'op' ? obj.ops.some((op) => op.id === p.opId) : p.key in obj.params);
    }
    if (ok) tracks[path] = keys;
    else changed = true;
  }
  return changed ? { ...scene, timeline: { ...scene.timeline, tracks } } : scene;
}

/**
 * Edit a value "at the playhead": animated values get a keyframe at time t,
 * static values change directly.
 */
export function editValue(scene: Scene, path: string, t: number, v: number): Scene {
  if (isAnimated(scene, path)) return setKey(scene, path, t, v);
  return writePath(scene, path, v);
}
