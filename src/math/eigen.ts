import { clone, multiply, transpose, type Mat } from './mat';

/**
 * Eigenvalues of a symmetric matrix via the cyclic Jacobi method.
 * Small matrices only (n <= ~10), which is all we ever need. Returned ascending.
 */
export function symmetricEigenvalues(sym: Mat): number[] {
  const n = sym.length;
  const a = clone(sym);
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  const ev: number[] = [];
  for (let i = 0; i < n; i++) ev.push(a[i][i]);
  return ev.sort((x, y) => x - y);
}

/** Singular values of a square matrix, ascending. */
export function singularValues(m: Mat): number[] {
  return symmetricEigenvalues(multiply(transpose(m), m)).map((x) => Math.sqrt(Math.max(0, x)));
}

/** [smallest, largest] singular value. */
export function singularRange(m: Mat): [number, number] {
  const sv = singularValues(m);
  return [sv[0], sv[sv.length - 1]];
}
