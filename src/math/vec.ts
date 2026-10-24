/**
 * Plain n-dimensional vectors. Dimension is always taken from the inputs;
 * nothing here assumes 3 or 4 components.
 */
export type Vec = number[];

export function zeros(n: number): Vec {
  return new Array<number>(n).fill(0);
}

/** Standard basis vector e_i in R^n. */
export function basis(n: number, i: number): Vec {
  const v = zeros(n);
  v[i] = 1;
  return v;
}

export function add(a: Vec, b: Vec): Vec {
  return a.map((x, i) => x + b[i]);
}

export function sub(a: Vec, b: Vec): Vec {
  return a.map((x, i) => x - b[i]);
}

export function scale(a: Vec, s: number): Vec {
  return a.map((x) => x * s);
}

/** a + s * b */
export function addScaled(a: Vec, b: Vec, s: number): Vec {
  return a.map((x, i) => x + s * b[i]);
}

export function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function norm(a: Vec): number {
  return Math.sqrt(dot(a, a));
}

export function normalize(a: Vec): Vec {
  const l = norm(a);
  return l > 0 ? scale(a, 1 / l) : a.slice();
}

export function dist(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export function lerp(a: Vec, b: Vec, t: number): Vec {
  return a.map((x, i) => x + (b[i] - x) * t);
}

export function cross3(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function centroid(points: Vec[]): Vec {
  const n = points[0]?.length ?? 0;
  const c = zeros(n);
  for (const p of points) for (let i = 0; i < n; i++) c[i] += p[i];
  return points.length > 0 ? scale(c, 1 / points.length) : c;
}

export function maxAbs(a: Vec): number {
  let m = 0;
  for (const x of a) m = Math.max(m, Math.abs(x));
  return m;
}
