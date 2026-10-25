/**
 * App state: the scene (with undo/redo), the playhead, selection and UI bits.
 * Rendering reads this store directly every frame; React subscribes to slices.
 */
import { create } from 'zustand';
import { editValue as editAtTime, evaluateTrack, pruneTracks, resolveScene, setKey } from './animation';
import { changeDimension, defaultScene, readPath, type Scene } from './model';

export interface HistoryOptions {
  /** Edits with the same key within a short window merge into one undo step (e.g. slider drags). */
  coalesce?: string;
  /** Skip history entirely. */
  transient?: boolean;
}

interface AppState {
  scene: Scene;
  past: Scene[];
  future: Scene[];
  lastCoalesce: { key: string; at: number } | null;

  time: number;
  playing: boolean;
  speed: number;
  selectedId: string | null;
  /** Bumped when the camera should re-frame the scene (e.g. after loading a preset). */
  cameraNonce: number;
  toast: { text: string; id: number } | null;

  setScene: (next: Scene | ((s: Scene) => Scene), opts?: HistoryOptions) => void;
  undo: () => void;
  redo: () => void;
  loadScene: (scene: Scene, opts?: { keepHistory?: boolean }) => void;

  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  select: (id: string | null) => void;

  /** Change a keyframable value at the playhead. */
  editValue: (path: string, v: number, coalesce?: boolean) => void;
  /** Add (or update) a keyframe at the playhead with the current value. */
  addKey: (path: string) => void;
  setDimension: (dim: number) => void;
  notify: (text: string) => void;
}

const HISTORY_LIMIT = 200;

export const useApp = create<AppState>((set, get) => ({
  scene: defaultScene(4),
  past: [],
  future: [],
  lastCoalesce: null,
  time: 0,
  playing: false,
  speed: 1,
  selectedId: null,
  cameraNonce: 0,
  toast: null,

  setScene: (next, opts = {}) => {
    const { scene, past, lastCoalesce } = get();
    const value = pruneTracks(typeof next === 'function' ? next(scene) : next);
    if (value === scene) return;
    if (opts.transient) {
      set({ scene: value });
      return;
    }
    const now = performance.now();
    const merge = opts.coalesce && lastCoalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.at < 1500;
    set({
      scene: value,
      past: merge ? past : [...past.slice(-HISTORY_LIMIT + 1), scene],
      future: [],
      lastCoalesce: opts.coalesce ? { key: opts.coalesce, at: now } : null,
    });
  },

  undo: () => {
    const { past, scene, future } = get();
    if (past.length === 0) return;
    set({ scene: past[past.length - 1], past: past.slice(0, -1), future: [scene, ...future], lastCoalesce: null });
  },

  redo: () => {
    const { past, scene, future } = get();
    if (future.length === 0) return;
    set({ scene: future[0], past: [...past, scene], future: future.slice(1), lastCoalesce: null });
  },

  loadScene: (scene, opts = {}) => {
    const { past, scene: prev } = get();
    set({
      scene,
      past: opts.keepHistory === false ? [] : [...past.slice(-HISTORY_LIMIT + 1), prev],
      future: [],
      time: 0,
      selectedId: scene.objects[0]?.id ?? null,
      cameraNonce: get().cameraNonce + 1,
      lastCoalesce: null,
    });
  },

  setTime: (t) => {
    const { scene } = get();
    const d = scene.timeline.duration;
    set({ time: Math.max(0, Math.min(d, t)) });
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  select: (selectedId) => set({ selectedId }),

  editValue: (path, v, coalesce = true) => {
    const { time } = get();
    get().setScene((s) => editAtTime(s, path, time, v), { coalesce: coalesce ? `edit:${path}` : undefined });
  },

  addKey: (path) => {
    const { time, scene } = get();
    const current = currentValue(scene, time, path);
    if (current === undefined) return;
    get().setScene((s) => setKey(s, path, time, current));
  },

  setDimension: (dim) => {
    const { scene } = get();
    if (scene.dim === dim) return;
    get().setScene(changeDimension(scene, dim));
    set({ cameraNonce: get().cameraNonce + 1 });
  },

  notify: (text) => set({ toast: { text, id: Date.now() } }),
}));

/** The value at a path at time t (animated or static). */
export function currentValue(scene: Scene, time: number, path: string): number | undefined {
  const keys = scene.timeline.tracks[path];
  if (keys && keys.length > 0) return evaluateTrack(keys, time);
  return readPath(scene, path);
}

/** React hook: the live value at a path (follows the playhead). */
export function useValue(path: string): number | undefined {
  return useApp((s) => currentValue(s.scene, s.time, path));
}

/** The scene as it looks at the current playhead. */
export function resolvedNow(): Scene {
  const { scene, time } = useApp.getState();
  return resolveScene(scene, time);
}

if (typeof window !== 'undefined') (window as unknown as { __app: typeof useApp }).__app = useApp;
