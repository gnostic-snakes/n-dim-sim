/**
 * Saving and loading scenes: JSON files, compressed share links and autosave.
 * Anything loaded from outside is validated and sanitized before use.
 */
import { hiddenCount, MAX_DIM, MIN_DIM, type Plane } from '../math/axes';
import { defaultOptions, defaultParams, getShape, hasShape } from '../shapes/registry';
import { pruneTracks, sortKeys } from './animation';
import { defaultView, newId, type Easing, type Keyframe, type Scene, type SceneObject, type TransformOp } from './model';

const EASINGS: Easing[] = ['linear', 'ease', 'ease-in', 'ease-out', 'hold'];

const num = (v: unknown, fallback: number, lo = -1e6, hi = 1e6): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const int = (v: unknown, fallback: number, lo: number, hi: number): number => Math.round(num(v, fallback, lo, hi));
const str = (v: unknown, fallback: string, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : fallback);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sanitizeOp(raw: unknown, dim: number): TransformOp | null {
  if (!isObj(raw)) return null;
  const kind = raw.kind;
  if (kind !== 'rotate' && kind !== 'translate' && kind !== 'scale') return null;
  const plane = Array.isArray(raw.plane) ? raw.plane : [0, 1];
  let a = int(plane[0], 0, 0, dim - 1);
  let b = int(plane[1], 1, 0, dim - 1);
  if (a === b) b = a === dim - 1 ? a - 1 : a + 1;
  if (a > b) [a, b] = [b, a];
  const axis = int(raw.axis, 0, -1, dim - 1);
  return {
    id: str(raw.id, newId('op'), 40),
    kind,
    enabled: raw.enabled !== false,
    plane: [a, b] as Plane,
    axis: kind === 'scale' ? axis : Math.max(0, axis),
    value: num(raw.value, kind === 'scale' ? 1 : 0, kind === 'scale' ? 0.001 : -1e5, 1e5),
  };
}

function sanitizeObject(raw: unknown, dim: number): SceneObject | null {
  if (!isObj(raw)) return null;
  const shape = str(raw.shape, '');
  if (!hasShape(shape) || !getShape(shape).dims(dim)) return null;
  const def = getShape(shape);
  const params = defaultParams(def);
  const rawParams = isObj(raw.params) ? raw.params : {};
  for (const p of def.params) params[p.key] = num(rawParams[p.key], p.default, p.min * 0.001, p.max * 100);
  const options = defaultOptions(def);
  const rawOptions = isObj(raw.options) ? raw.options : {};
  for (const o of def.options ?? []) options[o.key] = int(rawOptions[o.key], o.default, o.min, o.max);
  const ops = (Array.isArray(raw.ops) ? raw.ops : [])
    .slice(0, 64)
    .map((o) => sanitizeOp(o, dim))
    .filter((o): o is TransformOp => !!o);
  const color = typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : '#f2a65a';
  return {
    id: str(raw.id, newId('obj'), 40),
    shape,
    params,
    options,
    ops,
    color,
    visible: raw.visible !== false,
    label: typeof raw.label === 'string' ? raw.label.slice(0, 60) : undefined,
  };
}

export function sanitizeScene(raw: unknown): Scene {
  if (!isObj(raw)) throw new Error('Not a scene file');
  const dim = int(raw.dim, 4, MIN_DIM, MAX_DIM);
  const objects = (Array.isArray(raw.objects) ? raw.objects : [])
    .slice(0, 12)
    .map((o) => sanitizeObject(o, dim))
    .filter((o): o is SceneObject => !!o);
  if (objects.length === 0) throw new Error('The scene has no shapes this app knows about');
  // Object and op ids must be unique for keyframe paths to make sense.
  const seen = new Set<string>();
  for (const o of objects) {
    if (seen.has(o.id)) o.id = newId('obj');
    seen.add(o.id);
    const opSeen = new Set<string>();
    for (const op of o.ops) {
      if (opSeen.has(op.id)) op.id = newId('op');
      opSeen.add(op.id);
    }
  }
  const h = hiddenCount(dim);
  const rawSlice = Array.isArray(raw.slice) ? raw.slice : [];
  const slice = Array.from({ length: h }, (_, i) => num(rawSlice[i], 0, -100, 100));

  const view = defaultView();
  const rv = isObj(raw.view) ? raw.view : {};
  if (['solid', 'cells', 'tilt', 'depth'].includes(rv.shading as string)) view.shading = rv.shading as typeof view.shading;
  for (const key of ['edges', 'hiddenEdges', 'floor', 'shadows'] as const) if (typeof rv[key] === 'boolean') view[key] = rv[key] as boolean;
  if (isObj(rv.ghost)) {
    const g = rv.ghost;
    if (typeof g.visible === 'boolean') view.ghost.visible = g.visible;
    if (g.mode === 'shadow' || g.mode === 'perspective' || g.mode === 'side') view.ghost.mode = g.mode;
    if (typeof g.sync === 'boolean') view.ghost.sync = g.sync;
    view.ghost.sideAxis = int(g.sideAxis, Math.min(3, dim - 1), Math.min(3, dim - 1), dim - 1);
  }

  const rt = isObj(raw.timeline) ? raw.timeline : {};
  const duration = num(rt.duration, 8, 0.5, 600);
  const tracks: Scene['timeline']['tracks'] = {};
  if (isObj(rt.tracks)) {
    for (const [path, keys] of Object.entries(rt.tracks).slice(0, 200)) {
      if (!Array.isArray(keys) || typeof path !== 'string') continue;
      const clean: Keyframe[] = keys
        .slice(0, 500)
        .filter(isObj)
        .map((kf) => ({
          id: str(kf.id, newId('key'), 40),
          t: num(kf.t, 0, 0, duration),
          v: num(kf.v, 0, -1e5, 1e5),
          ease: EASINGS.includes(kf.ease as Easing) ? (kf.ease as Easing) : 'ease',
        }));
      if (clean.length) tracks[path.slice(0, 200)] = sortKeys(clean);
    }
  }
  let camera: Scene['camera'];
  if (isObj(raw.camera)) {
    const c = raw.camera;
    const t = Array.isArray(c.target) ? c.target : [0, 0, 0];
    camera = {
      yaw: num(c.yaw, 0.65),
      pitch: num(c.pitch, 0.38, -1.52, 1.52),
      distance: num(c.distance, 8.5, 0.5, 80),
      target: [num(t[0], 0, -1e3, 1e3), num(t[1], 0, -1e3, 1e3), num(t[2], 0, -1e3, 1e3)],
    };
  }
  return pruneTracks({
    version: 1,
    title: str(raw.title, 'Untitled', 120),
    dim,
    slice,
    objects,
    view,
    timeline: { duration, loop: rt.loop !== false, tracks },
    camera,
  });
}

// ---------------------------------------------------------------- encoding

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** Compact, URL-safe encoding of a scene (deflate when the browser supports it). */
export async function encodeScene(scene: Scene): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(scene));
  if (typeof CompressionStream !== 'undefined') {
    try {
      return `z${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
    } catch {
      // fall through
    }
  }
  return `j${toBase64Url(json)}`;
}

export async function decodeScene(code: string): Promise<Scene> {
  const kind = code[0];
  const bytes = fromBase64Url(code.slice(1));
  let json: Uint8Array;
  if (kind === 'z') json = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind === 'j') json = bytes;
  else throw new Error('Unrecognized link');
  return sanitizeScene(JSON.parse(new TextDecoder().decode(json)));
}

export function sceneToFile(scene: Scene): string {
  return JSON.stringify({ app: 'slice', ...scene }, null, 2);
}

const STORAGE_KEY = 'slice.scene.v1';

export function saveLocal(scene: Scene) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
  } catch {
    // storage unavailable (private mode, quota): autosave is best effort
  }
}

export function loadLocal(): Scene | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeScene(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
