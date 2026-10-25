/**
 * Slicing a thickened surface. A 2D surface in 4D meets the slice hyperplane
 * along a curve; a thin solid around the surface meets it in a thin tube
 * around that curve. We find the curve with marching squares on the surface's
 * parameter grid, then chain the pieces and group them into small chunks with
 * bounding spheres so the shader can skip most of them per ray.
 */
import { countComponents, marchingSquares } from './contour';
import { applyPoint } from './homogeneous';
import type { Mat } from './mat';
import type { Vec } from './vec';

export interface CurveSegment {
  a: Vec;
  b: Vec;
  /** Surface parameter u / 2π at each end (for colouring). */
  hueA: number;
  hueB: number;
  /** Shape-space hidden coordinate at each end, normalised to about [-1, 1]. */
  depthA: number;
  depthB: number;
}

export interface CurveChunk {
  center: Vec;
  radius: number;
  start: number;
  count: number;
}

export interface SurfaceSlice {
  segments: CurveSegment[];
  chunks: CurveChunk[];
  /** Number of separate closed curves (and arcs). */
  loops: number;
  tube: number;
}

const TAU = Math.PI * 2;
const CHUNK = 12;

export function sliceSurface(opts: {
  point: (u: number, v: number) => Vec;
  matrix: Mat;
  hidden: number[];
  k: number;
  grid: [number, number];
  tube: number;
  depthScale: number;
}): SurfaceSlice {
  const { point, matrix, hidden, k, grid, tube, depthScale } = opts;
  const [nu, nv] = grid;
  const du = TAU / nu;
  const dv = TAU / nv;
  const values: Float64Array[] = [];
  for (let i = 0; i <= nu; i++) {
    const col = new Float64Array(nv + 1);
    for (let j = 0; j <= nv; j++) {
      const w = applyPoint(matrix, point(i * du, j * dv));
      col[j] = w[k] - hidden[0];
    }
    values.push(col);
  }
  const raw = marchingSquares(values, 0, 0, du, dv);

  // Chain segments into curves (endpoints shared by neighbouring cells are bit-identical).
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  const ends = new Map<string, number[]>();
  raw.forEach((s, i) => {
    for (const p of [s.a, s.b]) {
      const kk = key(p);
      const list = ends.get(kk);
      if (list) list.push(i);
      else ends.set(kk, [i]);
    }
  });
  const used = new Uint8Array(raw.length);
  const order: { i: number; flip: boolean }[] = [];
  for (let start = 0; start < raw.length; start++) {
    if (used[start]) continue;
    // Walk forward from `start` through shared endpoints.
    let cur = start;
    let flip = false;
    while (cur >= 0 && !used[cur]) {
      used[cur] = 1;
      order.push({ i: cur, flip });
      const tail: [number, number] = flip ? raw[cur].a : raw[cur].b;
      const next: number | undefined = (ends.get(key(tail)) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      flip = key(raw[next].b) === key(tail);
      cur = next;
    }
  }

  const evalEnd = (p: [number, number]) => {
    const local = point(p[0], p[1]);
    const w = applyPoint(matrix, local);
    return { xyz: w.slice(0, k), hue: p[0] / TAU, depth: (local[k] ?? 0) * depthScale };
  };
  const cache = new Map<string, ReturnType<typeof evalEnd>>();
  const at = (p: [number, number]) => {
    const kk = key(p);
    let e = cache.get(kk);
    if (!e) {
      e = evalEnd(p);
      cache.set(kk, e);
    }
    return e;
  };
  const segments: CurveSegment[] = order.map(({ i, flip }) => {
    const s = raw[i];
    const a = at(flip ? s.b : s.a);
    const b = at(flip ? s.a : s.b);
    return { a: a.xyz, b: b.xyz, hueA: a.hue, hueB: b.hue, depthA: a.depth, depthB: b.depth };
  });

  const chunks: CurveChunk[] = [];
  for (let start = 0; start < segments.length; start += CHUNK) {
    const count = Math.min(CHUNK, segments.length - start);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let s = start; s < start + count; s++)
      for (const p of [segments[s].a, segments[s].b])
        for (let d = 0; d < k; d++) {
          lo[d] = Math.min(lo[d], p[d]);
          hi[d] = Math.max(hi[d], p[d]);
        }
    const center = lo.map((v, d) => (d < k ? (v + hi[d]) / 2 : 0));
    let r = 0;
    for (let s = start; s < start + count; s++)
      for (const p of [segments[s].a, segments[s].b]) r = Math.max(r, Math.hypot(...p.map((v, d) => v - center[d])));
    chunks.push({ center, radius: r + tube, start, count });
  }

  let scale = 1e-6;
  for (const s of segments) for (const v of s.a) scale = Math.max(scale, Math.abs(v));
  const loops = segments.length ? countComponents(segments, scale * 1e-6) : 0;
  return { segments, chunks, loops, tube };
}
