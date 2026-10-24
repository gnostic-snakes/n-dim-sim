/**
 * 3D convex hull (quickhull). Output triangles are counter-clockwise when seen
 * from outside. Coplanar input is fine: coplanar faces are simply left as
 * separate triangles (callers merge them by plane if they care).
 *
 * This runs every animation frame for big polytopes (the 600-cell slice has
 * ~300 candidate planes), so it avoids per-iteration allocations.
 */
import type { Vec } from './vec';

interface Face {
  v: [number, number, number];
  /** Neighbouring face across edge (v[e], v[e+1]). */
  adj: [Face | null, Face | null, Face | null];
  nx: number;
  ny: number;
  nz: number;
  d: number;
  outside: number[];
  alive: boolean;
  mark: number;
}

export interface Hull3 {
  faces: [number, number, number][];
  /** Indices of input points that are hull vertices. */
  vertices: number[];
}

export function convexHull3(points: Vec[], relEps = 1e-10): Hull3 | null {
  const n = points.length;
  if (n < 4) return null;
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const Z = new Float64Array(n);
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    X[i] = p[0];
    Y[i] = p[1];
    Z[i] = p[2];
    maxAbs = Math.max(maxAbs, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  }
  if (!(maxAbs > 0) || !Number.isFinite(maxAbs)) return null;
  const eps = relEps * maxAbs;

  // --- initial tetrahedron from extreme points ---
  const ext = [0, 0, 0, 0, 0, 0];
  const coords = [X, Y, Z];
  for (let i = 1; i < n; i++) {
    for (let ax = 0; ax < 3; ax++) {
      const c = coords[ax];
      if (c[i] < c[ext[2 * ax]]) ext[2 * ax] = i;
      if (c[i] > c[ext[2 * ax + 1]]) ext[2 * ax + 1] = i;
    }
  }
  let i0 = ext[0];
  let i1 = ext[1];
  let best = -1;
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++) {
      const p = ext[a];
      const q = ext[b];
      const dd = (X[p] - X[q]) ** 2 + (Y[p] - Y[q]) ** 2 + (Z[p] - Z[q]) ** 2;
      if (dd > best) {
        best = dd;
        i0 = p;
        i1 = q;
      }
    }
  if (Math.sqrt(best) < eps) return null;

  const lx = X[i1] - X[i0];
  const ly = Y[i1] - Y[i0];
  const lz = Z[i1] - Z[i0];
  const ll = Math.hypot(lx, ly, lz);
  let i2 = -1;
  best = eps;
  for (let i = 0; i < n; i++) {
    const vx = X[i] - X[i0];
    const vy = Y[i] - Y[i0];
    const vz = Z[i] - Z[i0];
    const dd = Math.hypot(vy * lz - vz * ly, vz * lx - vx * lz, vx * ly - vy * lx) / ll;
    if (dd > best) {
      best = dd;
      i2 = i;
    }
  }
  if (i2 < 0) return null;

  const makeFace = (a: number, b: number, c: number): Face => {
    const ux = X[b] - X[a];
    const uy = Y[b] - Y[a];
    const uz = Z[b] - Z[a];
    const vx = X[c] - X[a];
    const vy = Y[c] - Y[a];
    const vz = Z[c] - Z[a];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    return { v: [a, b, c], adj: [null, null, null], nx, ny, nz, d: nx * X[a] + ny * Y[a] + nz * Z[a], outside: [], alive: true, mark: 0 };
  };
  const dist = (f: Face, i: number) => f.nx * X[i] + f.ny * Y[i] + f.nz * Z[i] - f.d;

  // Orient the base so that the fourth point lies below it.
  const base = makeFace(i0, i1, i2);
  let i3 = -1;
  best = eps;
  for (let i = 0; i < n; i++) {
    const dd = Math.abs(dist(base, i));
    if (dd > best) {
      best = dd;
      i3 = i;
    }
  }
  if (i3 < 0) return null;
  let a0 = i0;
  let b0 = i1;
  if (dist(base, i3) > 0) [a0, b0] = [b0, a0];
  const c0 = i2;
  const faces: Face[] = [makeFace(a0, b0, c0), makeFace(b0, a0, i3), makeFace(c0, b0, i3), makeFace(a0, c0, i3)];

  /** Link faces f (edge e) and g that share the undirected edge {u, v}. */
  const link = (list: Face[]) => {
    const byEdge = new Map<number, [Face, number]>();
    for (const f of list) {
      for (let e = 0; e < 3; e++) {
        if (f.adj[e]) continue;
        const u = f.v[e];
        const w = f.v[(e + 1) % 3];
        const twin = byEdge.get(w * n + u);
        if (twin) {
          f.adj[e] = twin[0];
          twin[0].adj[twin[1]] = f;
          byEdge.delete(w * n + u);
        } else {
          byEdge.set(u * n + w, [f, e]);
        }
      }
    }
    return byEdge;
  };
  link(faces);

  const initial = new Set([i0, i1, i2, i3]);
  for (let i = 0; i < n; i++) {
    if (initial.has(i)) continue;
    for (const f of faces) {
      if (dist(f, i) > eps) {
        f.outside.push(i);
        break;
      }
    }
  }

  const stack: Face[] = faces.filter((f) => f.outside.length > 0);
  const visible: Face[] = [];
  const horizonFace: Face[] = [];
  const horizonEdge: number[] = [];
  let stamp = 0;
  let guard = 0;
  while (stack.length > 0) {
    if (++guard > 20 * n + 100) return null;
    const f = stack.pop()!;
    if (!f.alive || f.outside.length === 0) continue;

    let eye = f.outside[0];
    let far = dist(f, eye);
    for (const i of f.outside) {
      const dd = dist(f, i);
      if (dd > far) {
        far = dd;
        eye = i;
      }
    }

    // Visible faces (BFS) and the horizon: edges between visible and hidden faces.
    stamp++;
    visible.length = 0;
    horizonFace.length = 0;
    horizonEdge.length = 0;
    visible.push(f);
    f.mark = stamp;
    for (let qi = 0; qi < visible.length; qi++) {
      const vf = visible[qi];
      for (let e = 0; e < 3; e++) {
        const g = vf.adj[e];
        if (!g) return null;
        if (g.mark === stamp) continue;
        if (dist(g, eye) > eps) {
          g.mark = stamp;
          visible.push(g);
        } else {
          horizonFace.push(vf);
          horizonEdge.push(e);
        }
      }
    }

    // New faces: one per horizon edge, joined to the eye point.
    const created: Face[] = [];
    for (let h = 0; h < horizonFace.length; h++) {
      const vf = horizonFace[h];
      const e = horizonEdge[h];
      const u = vf.v[e];
      const w = vf.v[(e + 1) % 3];
      const nf = makeFace(u, w, eye);
      const outer = vf.adj[e]!;
      nf.adj[0] = outer;
      // Re-point the hidden neighbour's back-link from the dying face to the new one.
      for (let k = 0; k < 3; k++) if (outer.adj[k] === vf && outer.v[k] === w) outer.adj[k] = nf;
      created.push(nf);
    }
    // Stitch new faces to each other along their edges through the eye.
    const leftover = link(created);
    if (leftover.size > 0) return null; // horizon was not a simple loop

    for (const vf of visible) vf.alive = false;
    for (const vf of visible) {
      for (const i of vf.outside) {
        if (i === eye) continue;
        for (const nf of created) {
          if (dist(nf, i) > eps) {
            nf.outside.push(i);
            break;
          }
        }
      }
      vf.outside.length = 0;
    }
    for (const nf of created) {
      faces.push(nf);
      if (nf.outside.length > 0) stack.push(nf);
    }
  }

  const out: [number, number, number][] = [];
  const used = new Uint8Array(n);
  for (const f of faces) {
    if (!f.alive) continue;
    for (let e = 0; e < 3; e++) if (!f.adj[e] || !f.adj[e]!.alive) return null;
    out.push([f.v[0], f.v[1], f.v[2]]);
    used[f.v[0]] = used[f.v[1]] = used[f.v[2]] = 1;
  }
  const vertices: number[] = [];
  for (let i = 0; i < n; i++) if (used[i]) vertices.push(i);
  if (vertices.length - (3 * out.length) / 2 + out.length !== 2) return null;
  return { faces: out, vertices };
}
