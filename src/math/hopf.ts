/**
 * The Hopf fibration: the 3-sphere S³ ⊂ R⁴ ≅ C² splits into great circles,
 * one over each point of the 2-sphere. With z1 = x + iy, z2 = z + iw, the
 * fiber over the point of S² with polar angle θ and azimuth φ is
 *
 *   t ↦ ( cos(θ/2) e^{i(t + φ)}, sin(θ/2) e^{i t} ),   t ∈ [0, 2π).
 *
 * Stereographic projection from (0, 0, 0, 1) maps S³ minus that pole to R³
 * and sends every fiber to a circle (or to a line, for the fiber through the
 * pole). Any two fibers are linked exactly once.
 */
import { applyDirection } from './homogeneous';
import type { Mat } from './mat';
import { cross3, dot, norm, sub, type Vec } from './vec';

/** Point of the fiber over (theta, phi) at parameter t, in R⁴. */
export function fiberPoint(theta: number, phi: number, t: number): Vec {
  const a = Math.cos(theta / 2);
  const b = Math.sin(theta / 2);
  return [a * Math.cos(t + phi), a * Math.sin(t + phi), b * Math.cos(t), b * Math.sin(t)];
}

/** The Hopf map S³ → S² (for checking fibers). */
export function hopfMap(p: Vec): Vec {
  const [x, y, z, w] = p;
  // 2 z1 conj(z2) and |z1|² − |z2|²
  return [2 * (x * z + y * w), 2 * (y * z - x * w), x * x + y * y - z * z - w * w];
}

/** Stereographic projection of a unit 4-vector from the pole (0,0,0,1). */
export function stereographic(p: Vec): Vec {
  const d = 1 - p[3];
  return [p[0] / d, p[1] / d, p[2] / d];
}

export interface Circle3 {
  center: Vec;
  /** Unit normal of the circle's plane. */
  normal: Vec;
  /** Orthonormal in-plane axes (e1 points at the circle's first sample). */
  e1: Vec;
  e2: Vec;
  radius: number;
}

/** Circle through three points (null if they are collinear). */
export function circleThrough(p1: Vec, p2: Vec, p3: Vec): Circle3 | null {
  const a = sub(p2, p1);
  const b = sub(p3, p1);
  const n = cross3(a, b);
  const nn = dot(n, n);
  if (nn < 1e-18) return null;
  // Circumcenter: p1 + (|a|² (b × n) + |b|² (n × a)) / (2 |n|²)
  const bxn = cross3(b, n);
  const nxa = cross3(n, a);
  const aa = dot(a, a);
  const bb = dot(b, b);
  const center = [0, 1, 2].map((i) => p1[i] + (aa * bxn[i] + bb * nxa[i]) / (2 * nn));
  const radius = norm(sub(p1, center));
  const nl = Math.sqrt(nn);
  const normal = n.map((v) => v / nl);
  const r1 = sub(p1, center);
  const e1 = r1.map((v) => v / radius);
  const e2 = cross3(normal, e1);
  return { center, normal, e1, e2, radius };
}

/**
 * The projected fiber over (theta, phi) after a 4D rotation `rot` (a
 * homogeneous (5x5) matrix; only its linear part is used). Null when the
 * fiber passes (nearly) through the projection pole and becomes a line.
 */
export function projectedFiber(theta: number, phi: number, rot: Mat): Circle3 | null {
  const pts = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((t) => {
    const p = applyDirection(rot, fiberPoint(theta, phi, t));
    return p[3] > 1 - 1e-9 ? null : stereographic(p);
  });
  if (pts.some((p) => p === null)) return null;
  const c = circleThrough(pts[0]!, pts[1]!, pts[2]!);
  return c && Number.isFinite(c.radius) ? c : null;
}

/** Sample points of a circle. */
export function circlePoints(c: Circle3, n: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([0, 1, 2].map((k) => c.center[k] + c.radius * (Math.cos(a) * c.e1[k] + Math.sin(a) * c.e2[k])));
  }
  return out;
}

/** Gauss linking number of two closed polylines (numerical; ±1 for linked Hopf circles). */
export function linkingNumber(a: Vec[], b: Vec[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    const da = sub(a1, a0);
    const am = a0.map((v, k) => (v + a1[k]) / 2);
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j];
      const b1 = b[(j + 1) % b.length];
      const db = sub(b1, b0);
      const bm = b0.map((v, k) => (v + b1[k]) / 2);
      const r = sub(am, bm);
      const d = norm(r);
      sum += dot(r, cross3(da, db)) / (d * d * d);
    }
  }
  return sum / (4 * Math.PI);
}
