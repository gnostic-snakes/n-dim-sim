/**
 * Everything derived from a (resolved) scene that the renderer, the ghost view
 * and the info panel need: transforms, bounds, and for polytopes the exact
 * slice. Computed once per frame and cached between frames.
 */
import { sliceDim } from '../math/axes';
import { linearPart } from '../math/homogeneous';
import type { Mat } from '../math/mat';
import { sliceAffineMap, sliceConvexPolytope, type SlicePlane, type SliceResult } from '../math/slice';
import { composeStack, stretchRange } from '../math/transforms';
import type { Vec } from '../math/vec';
import { getShape, scaledFacets, sdfValues } from '../shapes/registry';
import type { PolytopeGeometry } from '../shapes/polytopes';
import type { ShapeDef, SurfaceShapeDef } from '../shapes/types';
import { sliceSurface, type SurfaceSlice } from '../math/surfaceSlice';
import { opSpec, type Scene, type SceneObject } from './model';

export interface PolytopeFrame {
  geometry: PolytopeGeometry;
  size: number;
  slice: SliceResult | null;
  /** Planes to render with (the exact faces, or a safe superset). */
  planes: SlicePlane[];
}

export interface ObjectFrame {
  obj: SceneObject;
  index: number;
  def: ShapeDef;
  n: number;
  k: number;
  /** shape -> world */
  matrix: Mat;
  /** world -> shape */
  inverse: Mat;
  /** Smallest / largest stretch of the transform. */
  stretch: [number, number];
  /** World-space n-D bounding ball. */
  center: Vec;
  radius: number;
  /** The bounding ball intersected with the slice (k-D), or null if the slice misses it. */
  sliceBall: { center: Vec; radius: number } | null;
  /** Slice coordinates -> shape space: p = L q + t0. */
  L: Mat;
  t0: Vec;
  /** Columns of the world->shape linear map for the hidden axes (n x (n-k)). */
  hiddenCols: Mat;
  polytope?: PolytopeFrame;
  sdf?: { values: Record<string, number>; lip: number };
  /** Thickened surfaces: the tube-shaped slice. */
  surface?: SurfaceSlice | null;
  /** True if something of this object is visible in the slice. */
  visible: boolean;
}

export interface FrameData {
  scene: Scene;
  n: number;
  k: number;
  objects: ObjectFrame[];
}

function sameMatrix(a: Mat, b: Mat): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a[i].length; j++) if (a[i][j] !== b[i][j]) return false;
  return true;
}

function sameVec(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

interface SliceCacheEntry {
  key: string;
  inverse: Mat;
  hidden: number[];
  slice: unknown;
}

export class FrameCache {
  private slices = new Map<string, SliceCacheEntry>();
  private last: { scene: Scene; frame: FrameData } | null = null;

  compute(scene: Scene): FrameData {
    if (this.last && this.last.scene === scene) return this.last.frame;
    const frame = computeFrame(scene, this);
    this.last = { scene, frame };
    return frame;
  }

  /** A per-object slice, reusing last frame's result when nothing relevant changed. */
  slice<T>(objId: string, key: string, inverse: Mat, hidden: number[], build: () => T): T {
    const e = this.slices.get(objId);
    if (e && e.key === key && sameMatrix(e.inverse, inverse) && sameVec(e.hidden, hidden)) return e.slice as T;
    const slice = build();
    this.slices.set(objId, { key, inverse, hidden: hidden.slice(), slice });
    return slice;
  }
}

export function computeFrame(scene: Scene, cache?: FrameCache): FrameData {
  const n = scene.dim;
  const k = sliceDim(n);
  const objects: ObjectFrame[] = [];
  scene.objects.forEach((obj, index) => {
    const def = getShape(obj.shape);
    if (!def.dims(n)) return;
    const ops = obj.ops.map(opSpec).filter((o) => o !== null);
    const { matrix, inverse } = composeStack(n, ops);
    const stretch = stretchRange(matrix);
    const center: Vec = [];
    for (let i = 0; i < n; i++) center.push(matrix[i][n]);
    const radius = def.boundingRadius(n, obj.params, obj.options) * stretch[1];
    let d2 = 0;
    for (let j = k; j < n; j++) d2 += (center[j] - (scene.slice[j - k] ?? 0)) ** 2;
    const r2 = radius * radius - d2;
    const sliceBall = r2 > 0 ? { center: center.slice(0, k), radius: Math.sqrt(r2) } : null;
    const { L, t0 } = sliceAffineMap(inverse, scene.slice, k);
    const lin = linearPart(inverse);
    const hiddenCols = lin.map((row) => row.slice(k));
    const frame: ObjectFrame = {
      obj,
      index,
      def,
      n,
      k,
      matrix,
      inverse,
      stretch,
      center,
      radius,
      sliceBall,
      L,
      t0,
      hiddenCols,
      visible: obj.visible && sliceBall !== null,
    };
    if (def.kind === 'polytope') {
      const geometry = def.geometry(n, obj.options);
      const size = obj.params.size ?? 1;
      let slice: SliceResult | null = null;
      if (sliceBall) {
        const build = () =>
          sliceConvexPolytope({ facets: scaledFacets(geometry, size), inverse, hidden: scene.slice, k, bound: sliceBall });
        const key = `${obj.shape}|${JSON.stringify(obj.options)}|${size}`;
        slice = cache ? cache.slice(obj.id, key, inverse, scene.slice, build) : build();
      }
      frame.polytope = { geometry, size, slice, planes: slice?.planes ?? [] };
      frame.visible = obj.visible && slice !== null;
    } else if (def.kind === 'surface') {
      let surface: SurfaceSlice | null = null;
      if (sliceBall && n - k === 1) {
        const sdef = def as SurfaceShapeDef;
        const params = obj.params;
        const build = () =>
          sliceSurface({
            point: (u, v) => sdef.point(u, v, params),
            matrix,
            hidden: scene.slice,
            k,
            grid: sdef.grid,
            tube: (params.t ?? 0.05) * stretch[0],
            depthScale: 1 / Math.max(1e-6, def.boundingRadius(n, params, obj.options)),
          });
        const key = `${obj.shape}|${JSON.stringify(params)}`;
        surface = cache ? cache.slice(obj.id, key, inverse, scene.slice, build) : build();
      }
      frame.surface = surface;
      frame.visible = obj.visible && !!surface && surface.segments.length > 0;
    } else {
      frame.sdf = { values: sdfValues(def, obj.params), lip: stretch[0] };
    }
    objects.push(frame);
  });
  return { scene, n, k, objects };
}
