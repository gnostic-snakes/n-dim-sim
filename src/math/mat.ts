import type { Vec } from './vec';

/** Row-major dense matrix: m[row][col]. */
export type Mat = number[][];

export function identity(size: number): Mat {
  const m: Mat = [];
  for (let i = 0; i < size; i++) {
    const row = new Array<number>(size).fill(0);
    row[i] = 1;
    m.push(row);
  }
  return m;
}

export function zerosMat(rows: number, cols: number): Mat {
  const m: Mat = [];
  for (let i = 0; i < rows; i++) m.push(new Array<number>(cols).fill(0));
  return m;
}

export function clone(a: Mat): Mat {
  return a.map((r) => r.slice());
}

export function multiply(a: Mat, b: Mat): Mat {
  const rows = a.length;
  const inner = b.length;
  const cols = b[0].length;
  const out = zerosMat(rows, cols);
  for (let i = 0; i < rows; i++) {
    const ai = a[i];
    const oi = out[i];
    for (let k = 0; k < inner; k++) {
      const aik = ai[k];
      if (aik === 0) continue;
      const bk = b[k];
      for (let j = 0; j < cols; j++) oi[j] += aik * bk[j];
    }
  }
  return out;
}

export function mulVec(a: Mat, v: Vec): Vec {
  return a.map((row) => {
    let s = 0;
    for (let j = 0; j < row.length; j++) s += row[j] * v[j];
    return s;
  });
}

export function transpose(a: Mat): Mat {
  const rows = a.length;
  const cols = a[0].length;
  const out = zerosMat(cols, rows);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = a[i][j];
  return out;
}

/** Gauss-Jordan inverse with partial pivoting. Returns null for singular matrices. */
export function inverse(a: Mat): Mat | null {
  const n = a.length;
  const m = clone(a);
  const inv = identity(n);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-14) return null;
    if (pivot !== col) {
      [m[pivot], m[col]] = [m[col], m[pivot]];
      [inv[pivot], inv[col]] = [inv[col], inv[pivot]];
    }
    const p = m[col][col];
    for (let j = 0; j < n; j++) {
      m[col][j] /= p;
      inv[col][j] /= p;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        m[r][j] -= f * m[col][j];
        inv[r][j] -= f * inv[col][j];
      }
    }
  }
  return inv;
}

/** Determinant via LU decomposition with partial pivoting. */
export function determinant(a: Mat): number {
  const n = a.length;
  const m = clone(a);
  let det = 1;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (m[pivot][col] === 0) return 0;
    if (pivot !== col) {
      [m[pivot], m[col]] = [m[col], m[pivot]];
      det = -det;
    }
    det *= m[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let j = col; j < n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return det;
}

/** Solve a x = b for square a. Returns null when singular. */
export function solve(a: Mat, b: Vec): Vec | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-14) return null;
    [m[pivot], m[col]] = [m[col], m[pivot]];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      if (f === 0) continue;
      for (let j = col; j <= n; j++) m[r][j] -= f * m[col][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let j = i + 1; j < n; j++) s -= m[i][j] * x[j];
    x[i] = s / m[i][i];
  }
  return x;
}

/** Largest absolute entry-wise difference. */
export function maxAbsDiff(a: Mat, b: Mat): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a[i].length; j++) d = Math.max(d, Math.abs(a[i][j] - b[i][j]));
  return d;
}

export function isOrthogonal(a: Mat, tol = 1e-9): boolean {
  return maxAbsDiff(multiply(transpose(a), a), identity(a.length)) < tol;
}

/** Extract rows r0..r1-1, cols c0..c1-1. */
export function block(a: Mat, r0: number, r1: number, c0: number, c1: number): Mat {
  const out: Mat = [];
  for (let i = r0; i < r1; i++) out.push(a[i].slice(c0, c1));
  return out;
}
