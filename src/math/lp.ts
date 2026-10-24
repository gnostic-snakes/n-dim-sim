/**
 * Chebyshev center of a convex region { q in R^k : a_i . q <= c_i } (unit a_i):
 * the center and radius of the largest ball that fits inside.
 *
 * Primal:  maximize r  s.t.  a_i . q + r <= c_i         (q, r free)
 * Dual:    minimize sum c_i y_i  s.t.  sum y_i a_i = 0, sum y_i = 1, y >= 0
 *
 * The dual has only k + 1 equality rows (k <= 3 for us), so a dense two-phase
 * simplex tableau over the m dual variables is tiny and fast even for the
 * 600-cell. The primal solution (q, r) is recovered from the simplex
 * multipliers at the optimum. Bland's rule keeps the (very common, thanks to
 * symmetry) degenerate pivots from cycling.
 */
import type { Vec } from './vec';

export interface ChebyshevResult {
  center: Vec;
  /** <= 0 means the region is empty or has no interior. */
  radius: number;
}

const EPS = 1e-11;

/** Returns null if the region is unbounded (normals do not surround the origin). */
export function chebyshevCenter(normals: Vec[], offsets: number[], k: number): ChebyshevResult | null {
  const m = normals.length;
  const rows = k + 1;
  if (m === 0) return null;
  const cols = m + rows; // dual variables + artificials
  const rhs = cols; // index of the RHS column

  const t: Float64Array[] = [];
  for (let r = 0; r < rows; r++) {
    const row = new Float64Array(cols + 1);
    for (let i = 0; i < m; i++) row[i] = r < k ? normals[i][r] : 1;
    row[m + r] = 1;
    row[rhs] = r < k ? 0 : 1;
    t.push(row);
  }
  const basis = new Int32Array(rows);
  for (let r = 0; r < rows; r++) basis[r] = m + r;

  const z = new Float64Array(cols + 1); // reduced costs; z[rhs] = -objective

  const pivot = (pr: number, pc: number) => {
    const prow = t[pr];
    const inv = 1 / prow[pc];
    for (let j = 0; j <= cols; j++) prow[j] *= inv;
    prow[pc] = 1;
    for (let r = 0; r < rows; r++) {
      if (r === pr) continue;
      const f = t[r][pc];
      if (f === 0) continue;
      const row = t[r];
      for (let j = 0; j <= cols; j++) row[j] -= f * prow[j];
      row[pc] = 0;
    }
    const f = z[pc];
    if (f !== 0) {
      for (let j = 0; j <= cols; j++) z[j] -= f * prow[j];
      z[pc] = 0;
    }
    basis[pr] = pc;
  };

  const setObjective = (cost: (j: number) => number) => {
    for (let j = 0; j <= cols; j++) z[j] = j < cols ? cost(j) : 0;
    for (let r = 0; r < rows; r++) {
      const cb = cost(basis[r]);
      if (cb === 0) continue;
      for (let j = 0; j <= cols; j++) z[j] -= cb * t[r][j];
    }
  };

  /** Run simplex iterations; entering columns limited to j < enterLimit. Returns false if unbounded. */
  const run = (enterLimit: number): boolean => {
    const maxIter = 50 * (cols + rows) + 100;
    for (let iter = 0; iter < maxIter; iter++) {
      let e = -1;
      for (let j = 0; j < enterLimit; j++) {
        if (z[j] < -EPS) {
          e = j;
          break;
        }
      }
      if (e < 0) return true;
      let leave = -1;
      let best = Infinity;
      for (let r = 0; r < rows; r++) {
        const a = t[r][e];
        if (a > EPS) {
          const ratio = t[r][rhs] / a;
          if (ratio < best - 1e-14 || (Math.abs(ratio - best) <= 1e-14 && basis[r] < basis[leave])) {
            best = ratio;
            leave = r;
          }
        }
      }
      if (leave < 0) return false;
      pivot(leave, e);
    }
    return true; // iteration cap: return the best basis found
  };

  // Phase 1: minimize the sum of artificials.
  setObjective((j) => (j >= m ? 1 : 0));
  run(cols);
  if (-z[rhs] > 1e-9) return null; // dual infeasible => primal unbounded

  // Drive remaining artificials out of the basis.
  for (let r = 0; r < rows; r++) {
    if (basis[r] < m) continue;
    let pc = -1;
    let bestAbs = 1e-9;
    for (let j = 0; j < m; j++) {
      const a = Math.abs(t[r][j]);
      if (a > bestAbs) {
        bestAbs = a;
        pc = j;
      }
    }
    if (pc < 0) return null; // redundant row: some direction is unconstrained
    pivot(r, pc);
  }

  // Phase 2: minimize sum c_i y_i, artificials may not re-enter.
  setObjective((j) => (j < m ? offsets[j] : 0));
  if (!run(m)) return null;

  // Simplex multipliers pi = c_B B^-1 = -(reduced costs of the artificial columns).
  const pi: number[] = [];
  for (let r = 0; r < rows; r++) pi.push(-z[m + r]);
  return { center: pi.slice(0, k), radius: pi[k] };
}
