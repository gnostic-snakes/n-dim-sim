/**
 * (n+1)x(n+1) homogeneous matrices for n-dimensional affine transforms.
 * Points are column vectors [x_0 .. x_{n-1}, 1]; the last row is [0 .. 0 1].
 */
import { identity, type Mat } from './mat';
import type { Vec } from './vec';

/**
 * Rotation in the plane spanned by axes a and b by angle theta (radians).
 * R[a][a] = cos, R[a][b] = -sin, R[b][a] = sin, R[b][b] = cos: points move
 * within the (a, b) plane, rotating axis a towards axis b; all other
 * coordinates stay fixed.
 */
export function rotation(n: number, a: number, b: number, theta: number): Mat {
  if (a === b || a < 0 || b < 0 || a >= n || b >= n) throw new Error(`Invalid rotation plane (${a}, ${b}) in ${n}D`);
  const m = identity(n + 1);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  m[a][a] = c;
  m[a][b] = -s;
  m[b][a] = s;
  m[b][b] = c;
  return m;
}

export function translation(n: number, axis: number, amount: number): Mat {
  const m = identity(n + 1);
  m[axis][n] = amount;
  return m;
}

export function translationVec(t: Vec): Mat {
  const n = t.length;
  const m = identity(n + 1);
  for (let i = 0; i < n; i++) m[i][n] = t[i];
  return m;
}

/** Scale along one axis, or all axes when axis === 'uniform'. */
export function scaling(n: number, axis: number | 'uniform', factor: number): Mat {
  const m = identity(n + 1);
  if (axis === 'uniform') {
    for (let i = 0; i < n; i++) m[i][i] = factor;
  } else {
    m[axis][axis] = factor;
  }
  return m;
}

/** Apply a homogeneous matrix to an n-D point. */
export function applyPoint(m: Mat, p: Vec): Vec {
  const n = p.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const row = m[i];
    let s = row[n];
    for (let j = 0; j < n; j++) s += row[j] * p[j];
    out[i] = s;
  }
  return out;
}

/** Apply only the linear part (directions are unaffected by translation). */
export function applyDirection(m: Mat, v: Vec): Vec {
  const n = v.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const row = m[i];
    let s = 0;
    for (let j = 0; j < n; j++) s += row[j] * v[j];
    out[i] = s;
  }
  return out;
}

/** The n x n linear block. */
export function linearPart(m: Mat): Mat {
  const n = m.length - 1;
  const out: Mat = [];
  for (let i = 0; i < n; i++) out.push(m[i].slice(0, n));
  return out;
}

/** The translation column. */
export function translationPart(m: Mat): Vec {
  const n = m.length - 1;
  const out: Vec = [];
  for (let i = 0; i < n; i++) out.push(m[i][n]);
  return out;
}

export function dimensionOf(m: Mat): number {
  return m.length - 1;
}
