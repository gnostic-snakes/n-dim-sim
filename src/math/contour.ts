/**
 * Marching squares: the zero set of a function sampled on a grid, as line
 * segments in parameter space. Used to find where a 2D surface living in 4D
 * crosses the slice hyperplane.
 */

const nudge = (f: number) => (f === 0 ? 1e-12 : f);

export interface ParamSegment {
  /** Endpoints in parameter space (u, v). */
  a: [number, number];
  b: [number, number];
}

/**
 * `values[i][j]` samples f at (u0 + i*du, v0 + j*dv) for i = 0..nu, j = 0..nv
 * (inclusive). Returns the segments of { f = 0 }.
 */
export function marchingSquares(values: Float64Array[], u0: number, v0: number, du: number, dv: number): ParamSegment[] {
  const nu = values.length - 1;
  const nv = values[0].length - 1;
  const out: ParamSegment[] = [];
  const lerp = (fa: number, fb: number) => (Math.abs(fa - fb) < 1e-300 ? 0.5 : fa / (fa - fb));
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      // Exact zeros on grid vertices would make several edges report the same crossing;
      // nudging them consistently (every cell sees the same vertex value) avoids that.
      const f00 = nudge(values[i][j]);
      const f10 = nudge(values[i + 1][j]);
      const f11 = nudge(values[i + 1][j + 1]);
      const f01 = nudge(values[i][j + 1]);
      const code = (f00 > 0 ? 1 : 0) | (f10 > 0 ? 2 : 0) | (f11 > 0 ? 4 : 0) | (f01 > 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      // Grid coordinates are always computed as u0 + i * du so that neighbouring
      // cells produce bit-identical points on their shared edge.
      const u = u0 + i * du;
      const v = v0 + j * dv;
      const u1 = u0 + (i + 1) * du;
      const v1 = v0 + (j + 1) * dv;
      // Crossing points on the four cell edges (bottom, right, top, left).
      const e = (k: number): [number, number] => {
        switch (k) {
          case 0:
            return [u + lerp(f00, f10) * du, v];
          case 1:
            return [u1, v + lerp(f10, f11) * dv];
          case 2:
            return [u + lerp(f01, f11) * du, v1];
          default:
            return [u, v + lerp(f00, f01) * dv];
        }
      };
      const seg = (p: number, q: number) => out.push({ a: e(p), b: e(q) });
      switch (code) {
        case 1:
        case 14:
          seg(3, 0);
          break;
        case 2:
        case 13:
          seg(0, 1);
          break;
        case 3:
        case 12:
          seg(3, 1);
          break;
        case 4:
        case 11:
          seg(1, 2);
          break;
        case 6:
        case 9:
          seg(0, 2);
          break;
        case 7:
        case 8:
          seg(3, 2);
          break;
        case 5:
        case 10: {
          // Saddle: decide the connection by the value at the cell centre.
          const centre = (f00 + f10 + f11 + f01) / 4 > 0 ? 1 : 0;
          if ((code === 5) === (centre === 1)) {
            seg(3, 2);
            seg(0, 1);
          } else {
            seg(3, 0);
            seg(1, 2);
          }
          break;
        }
      }
    }
  }
  return out;
}

/** Number of connected loops/arcs formed by segments whose endpoints coincide. */
export function countComponents(points: { a: number[]; b: number[] }[], tol: number): number {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const key = (p: number[]) => p.map((x) => Math.round(x / tol)).join(',');
  const owner = new Map<string, number>();
  points.forEach((s, i) => {
    for (const p of [s.a, s.b]) {
      const k = key(p);
      const o = owner.get(k);
      if (o === undefined) owner.set(k, i);
      else parent[find(i)] = find(o);
    }
  });
  const roots = new Set(points.map((_, i) => find(i)));
  return roots.size;
}
