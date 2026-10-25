/**
 * The scene: what the user builds and what gets saved, shared and animated.
 * Plain JSON-serializable data; all derived geometry lives in ./frame.ts.
 */
import { hiddenCount, sliceDim, type Plane } from '../math/axes';
import type { TransformOpSpec } from '../math/transforms';
import { defaultOptions, defaultParams, getShape, hasShape, shapesForDim } from '../shapes/registry';

export type OpKind = 'rotate' | 'translate' | 'scale';

/** Axis index used by scale ops to mean "all axes". */
export const UNIFORM = -1;

export interface TransformOp {
  id: string;
  kind: OpKind;
  enabled: boolean;
  /** Rotation plane (rotate). */
  plane: Plane;
  /** Axis (translate/scale); UNIFORM for uniform scale. */
  axis: number;
  /** Angle in degrees / distance / factor. This is the keyframable number. */
  value: number;
}

export interface SceneObject {
  id: string;
  shape: string;
  params: Record<string, number>;
  options: Record<string, number>;
  ops: TransformOp[];
  color: string;
  visible: boolean;
  /** Optional label shown in the object list. */
  label?: string;
}

export type ShadingMode = 'solid' | 'cells' | 'tilt' | 'depth';
export type GhostMode = 'shadow' | 'perspective' | 'side';
export type Easing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'hold';

export interface Keyframe {
  id: string;
  t: number;
  v: number;
  ease: Easing;
}

export interface ViewSettings {
  shading: ShadingMode;
  edges: boolean;
  hiddenEdges: boolean;
  floor: boolean;
  shadows: boolean;
  ghost: { visible: boolean; mode: GhostMode; sync: boolean; sideAxis: number };
}

export interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
}

export interface Scene {
  version: 1;
  title?: string;
  dim: number;
  /** Slice offset for each hidden axis (index 0 = first hidden axis). */
  slice: number[];
  objects: SceneObject[];
  view: ViewSettings;
  timeline: { duration: number; loop: boolean; tracks: Record<string, Keyframe[]> };
  camera?: CameraState;
}

let idCounter = 0;
export function newId(prefix = 'id'): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36).slice(-4)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const OBJECT_COLORS = ['#f2a65a', '#6cc3d5', '#b48ef0', '#7bd389', '#f07c8f', '#e8d36a', '#8fa7ff'];

export function makeOp(kind: OpKind, init: Partial<TransformOp> = {}): TransformOp {
  return {
    id: newId('op'),
    kind,
    enabled: true,
    plane: [0, 3],
    axis: kind === 'scale' ? UNIFORM : 3,
    value: kind === 'scale' ? 1 : 0,
    ...init,
  };
}

export function makeObject(shape: string, init: Partial<SceneObject> = {}): SceneObject {
  const def = getShape(shape);
  return {
    id: newId('obj'),
    shape,
    params: defaultParams(def),
    options: defaultOptions(def),
    ops: [],
    color: OBJECT_COLORS[0],
    visible: true,
    ...init,
  };
}

export function defaultView(): ViewSettings {
  return {
    shading: 'cells',
    edges: true,
    hiddenEdges: false,
    floor: true,
    shadows: true,
    ghost: { visible: true, mode: 'shadow', sync: true, sideAxis: 3 },
  };
}

export function defaultScene(dim = 4): Scene {
  return {
    version: 1,
    title: 'Untitled',
    dim,
    slice: new Array(hiddenCount(dim)).fill(0),
    objects: [makeObject('hypercube', { ops: [makeOp('rotate', { plane: dim >= 4 ? [0, 3] : [1, 2], value: 0 })] })],
    view: defaultView(),
    timeline: { duration: 8, loop: true, tracks: {} },
  };
}

/** Convert a scene op into the pure math op (null when disabled). */
export function opSpec(op: TransformOp): TransformOpSpec | null {
  if (!op.enabled) return null;
  switch (op.kind) {
    case 'rotate':
      return { kind: 'rotate', plane: op.plane, angle: op.value };
    case 'translate':
      return { kind: 'translate', axis: op.axis, amount: op.value };
    case 'scale':
      return { kind: 'scale', axis: op.axis === UNIFORM ? 'uniform' : op.axis, factor: op.value };
  }
}

// ---------------------------------------------------------------- parameter paths

/** Every keyframable number has a path. */
export const paths = {
  slice: (hiddenIndex: number) => `slice.${hiddenIndex}`,
  op: (objId: string, opId: string) => `obj.${objId}.op.${opId}`,
  param: (objId: string, key: string) => `obj.${objId}.param.${key}`,
};

export type ParsedPath =
  { kind: 'slice'; index: number } | { kind: 'op'; objId: string; opId: string } | { kind: 'param'; objId: string; key: string };

export function parsePath(path: string): ParsedPath | null {
  const parts = path.split('.');
  if (parts[0] === 'slice' && parts.length === 2) return { kind: 'slice', index: Number(parts[1]) };
  if (parts[0] === 'obj' && parts.length === 4) {
    if (parts[2] === 'op') return { kind: 'op', objId: parts[1], opId: parts[3] };
    if (parts[2] === 'param') return { kind: 'param', objId: parts[1], key: parts[3] };
  }
  return null;
}

/** Read the static (un-animated) value at a path. */
export function readPath(scene: Scene, path: string): number | undefined {
  const p = parsePath(path);
  if (!p) return undefined;
  if (p.kind === 'slice') return scene.slice[p.index];
  const obj = scene.objects.find((o) => o.id === p.objId);
  if (!obj) return undefined;
  if (p.kind === 'op') return obj.ops.find((o) => o.id === p.opId)?.value;
  return obj.params[p.key];
}

/** Return a copy of the scene with the value at `path` replaced. */
export function writePath(scene: Scene, path: string, value: number): Scene {
  const p = parsePath(path);
  if (!p) return scene;
  if (p.kind === 'slice') {
    const slice = scene.slice.slice();
    slice[p.index] = value;
    return { ...scene, slice };
  }
  return {
    ...scene,
    objects: scene.objects.map((o) => {
      if (o.id !== p.objId) return o;
      if (p.kind === 'op') return { ...o, ops: o.ops.map((op) => (op.id === p.opId ? { ...op, value } : op)) };
      return { ...o, params: { ...o.params, [p.key]: value } };
    }),
  };
}

export function pathExists(scene: Scene, path: string): boolean {
  return readPath(scene, path) !== undefined;
}

// ---------------------------------------------------------------- dimension changes

/** Closest equivalent shape in another dimension. */
export function shapeForDim(shape: string, dim: number): string {
  if (hasShape(shape) && getShape(shape).dims(dim)) return shape;
  const fallback: Record<string, string> = {
    cell24: 'cross',
    cell600: 'simplex',
    cell120: 'hypercube',
    duoprism: 'hypercube',
    prism: 'hypercube',
    duocylinder: 'ball',
    spherinder: 'ball',
    cubinder: 'ball',
    clifford: dim === 3 ? 'torus' : 'ball',
    spheritorus: dim === 3 ? 'torus' : 'ball',
    torisphere: 'ball',
    ditorus: dim === 3 ? 'torus' : 'ball',
    hypercone: dim === 3 ? 'cone' : 'ball',
    klein: dim === 3 ? 'torus' : 'ball',
    torus: dim === 4 ? 'spheritorus' : 'ball',
    cylinder: dim === 4 ? 'spherinder' : 'ball',
    cone: dim === 4 ? 'hypercone' : 'ball',
    dodecahedron: dim === 4 ? 'cell120' : 'hypercube',
    icosahedron: dim === 4 ? 'cell600' : 'cross',
  };
  const f = fallback[shape];
  if (f && hasShape(f) && getShape(f).dims(dim)) return f;
  return shapesForDim(dim)[0].id;
}

function fitAxis(axis: number, dim: number): number {
  return axis < dim ? axis : dim - 1;
}

/** Move a scene to another dimension, keeping as much as makes sense. */
export function changeDimension(scene: Scene, dim: number): Scene {
  const objects = scene.objects.map((o) => {
    const shape = shapeForDim(o.shape, dim);
    const def = getShape(shape);
    const params = shape === o.shape ? o.params : defaultParams(def);
    const options = shape === o.shape ? o.options : defaultOptions(def);
    const ops = o.ops
      .map((op) => {
        if (op.kind === 'rotate') {
          let [a, b] = op.plane;
          if (b >= dim) b = dim - 1;
          if (a >= b) a = b - 1;
          return { ...op, plane: [a, b] as Plane };
        }
        return { ...op, axis: op.axis === UNIFORM ? UNIFORM : fitAxis(op.axis, dim) };
      })
      .filter((op) => op.kind !== 'rotate' || op.plane[0] >= 0);
    return { ...o, shape, params, options, ops };
  });
  const h = hiddenCount(dim);
  const slice = new Array(h).fill(0).map((_, i) => scene.slice[i] ?? 0);
  // Drop tracks that no longer resolve.
  const next: Scene = { ...scene, dim, slice, objects };
  const tracks: Scene['timeline']['tracks'] = {};
  for (const [path, keys] of Object.entries(scene.timeline.tracks)) if (pathExists(next, path)) tracks[path] = keys;
  const sideAxis = Math.min(Math.max(scene.view.ghost.sideAxis, sliceDim(dim)), dim - 1);
  return { ...next, timeline: { ...scene.timeline, tracks }, view: { ...scene.view, ghost: { ...scene.view.ghost, sideAxis } } };
}
