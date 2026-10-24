/**
 * Exact slicing of convex n-D polytopes.
 *
 * A convex polytope is { p : n_i . p <= b_i } in shape space. The object
 * transform maps shape space to world space, and the visible world is the
 * k-dimensional slice where every hidden world coordinate equals its slice
 * offset. Composing "embed slice point q into n-D" with "world -> shape" is an
 * affine map p = L q + t0, so every facet restricts to a k-D half-space
 * (L^T n_i) . q <= b_i - n_i . t0. Their intersection is the slice polytope.
 *
 * To turn half-spaces into vertices/edges/faces we find a deep interior point
 * (Chebyshev center LP), dualize each half-space to a point, and take a convex
 * hull of the dual points: hull vertices are the non-redundant half-spaces and
 * hull facets are the slice polytope's vertices. This works for any n, any
 * number of hidden axes, and any (invertible affine) transform.
 */
import { convexHull2 } from './hull2';
import { convexHull3 } from './hull3';
import { chebyshevCenter } from './lp';
import { solve, type Mat } from './mat';
import { cross3, dot, norm, normalize, sub, type Vec } from './vec';

export interface Facet {
  /** Unit outward normal in shape space. */
  normal: Vec;
  /** Half-space is normal . p <= offset. */
  offset: number;
}

/** A k-D half-space normal . q <= offset produced by one (or several coinciding) n-D facets. */
export interface SlicePlane {
  normal: Vec;
  offset: number;
  facets: number[];
  /** Unit world-space n-D normal of the facet, restricted to the hidden axes. */
  hiddenNormal: Vec;
}

export interface SliceFace extends SlicePlane {
  /** Vertex indices, counter-clockwise seen from outside (k = 3) or the two endpoints of a side (k = 2). */
  loop: number[];
}

export interface SliceResult {
  k: number;
  /** False if the exact combinatorial structure could not be computed (planes are then a safe superset). */
  exact: boolean;
  /** Planes to render with. Exact: exactly the slice's faces. Fallback: candidate planes. */
  planes: SlicePlane[];
  vertices: Vec[];
  edges: [number, number][];
  faces: SliceFace[];
  center: Vec;
  inradius: number;
}

export interface SliceSetup {
  facets: Facet[];
  /** World -> shape homogeneous matrix ((n+1) x (n+1)). */
  inverse: Mat;
  /** Slice offsets of the hidden world axes k..n-1. */
  hidden: number[];
  /** Slice dimension (3, or 2 in Flatland). */
  k: number;
  /** Optional ball (in slice coordinates) known to contain the slice; used to cull planes early. */
  bound?: { center: Vec; radius: number };
}

/** The affine map from slice coordinates q (k-D) to shape space: p = L q + t0. */
export function sliceAffineMap(inverse: Mat, hidden: number[], k: number): { L: Mat; t0: Vec } {
  const n = inverse.length - 1;
  const L: Mat = [];
  const t0: Vec = [];
  for (let i = 0; i < n; i++) {
    const row = inverse[i];
    L.push(row.slice(0, k));
    let t = row[n];
    for (let j = k; j < n; j++) t += row[j] * hidden[j - k];
    t0.push(t);
  }
  return { L, t0 };
}

interface Restricted {
  normals: Vec[];
  offsets: number[];
  facetIds: number[];
  hiddenNormals: Vec[];
  empty: boolean;
}

/** Restrict all facets to the slice. Degenerate (parallel to the slice) facets are dropped or flag emptiness. */
export function restrictFacets(setup: SliceSetup): Restricted {
  const { facets, inverse, hidden, k } = setup;
  const n = inverse.length - 1;
  const { t0 } = sliceAffineMap(inverse, hidden, k);
  const out: Restricted = { normals: [], offsets: [], facetIds: [], hiddenNormals: [], empty: false };
  for (let f = 0; f < facets.length; f++) {
    const { normal, offset } = facets[f];
    // World normal (unnormalized) = B^T n where B is the linear part of `inverse`.
    const world: Vec = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const ni = normal[i];
      if (ni === 0) continue;
      const row = inverse[i];
      for (let j = 0; j < n; j++) world[j] += row[j] * ni;
    }
    const a = world.slice(0, k);
    const c = offset - dot(normal, t0);
    const worldLen = norm(world);
    const aLen = norm(a);
    if (aLen < 1e-12 * Math.max(worldLen, 1e-300)) {
      // Facet is parallel to the slice: either everything or nothing satisfies it.
      if (c < -1e-9 * Math.max(1, Math.abs(offset))) out.empty = true;
      continue;
    }
    out.normals.push(a.map((x) => x / aLen));
    out.offsets.push(c / aLen);
    out.facetIds.push(f);
    out.hiddenNormals.push(world.slice(k).map((x) => x / worldLen));
  }
  return out;
}

function orderLoop(points: Vec[], ids: number[], normal: Vec): number[] {
  const c = [0, 0, 0];
  for (const i of ids) for (let d = 0; d < 3; d++) c[d] += points[i][d] / ids.length;
  // In-plane basis (e1, e2) with e1 x e2 = normal.
  const helper = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = normalize(cross3(helper, normal));
  const e2 = cross3(normal, e1);
  return ids
    .map((i) => {
      const v = sub(points[i], c);
      return { i, ang: Math.atan2(dot(v, e2), dot(v, e1)) };
    })
    .sort((x, y) => x.ang - y.ang)
    .map((x) => x.i);
}

/**
 * Compute the slice of a convex polytope. Returns null when the slice is empty
 * (or has no interior, e.g. it only touches a vertex).
 */
export function sliceConvexPolytope(setup: SliceSetup): SliceResult | null {
  const { k } = setup;
  const r = restrictFacets(setup);
  if (r.empty) return null;

  // Early culling against a known bounding ball.
  let normals = r.normals;
  let offsets = r.offsets;
  let facetIds = r.facetIds;
  let hiddenNormals = r.hiddenNormals;
  let origin: Vec = new Array(k).fill(0);
  if (setup.bound) {
    const { center, radius } = setup.bound;
    if (!(radius > 0)) return null;
    origin = center.slice(0, k);
    const keep: number[] = [];
    for (let i = 0; i < normals.length; i++) {
      const s = dot(normals[i], origin);
      if (s - radius > offsets[i]) return null; // the whole ball is outside this half-space
      if (s + radius > offsets[i] - 1e-12 * radius) keep.push(i);
    }
    normals = keep.map((i) => normals[i]);
    offsets = keep.map((i) => offsets[i]);
    facetIds = keep.map((i) => facetIds[i]);
    hiddenNormals = keep.map((i) => hiddenNormals[i]);
  }
  if (normals.length < k + 1) return null;

  // Work in coordinates centred on `origin` for numerical conditioning.
  const local = offsets.map((o, i) => o - dot(normals[i], origin));
  const cheb = chebyshevCenter(normals, local, k);
  const planesAll = (): SlicePlane[] =>
    normals.map((nrm, i) => ({ normal: nrm, offset: offsets[i], facets: [facetIds[i]], hiddenNormal: hiddenNormals[i] }));
  if (!cheb) {
    // Unbounded according to the LP (should not happen for polytopes); render with all planes.
    return {
      k,
      exact: false,
      planes: planesAll(),
      vertices: [],
      edges: [],
      faces: [],
      center: origin,
      inradius: 0,
    };
  }
  let scale = setup.bound?.radius ?? 0;
  for (const o of local) scale = Math.max(scale, Math.abs(o));
  scale = Math.max(scale, 1e-9);
  if (cheb.radius <= 1e-9 * scale) return null;

  const q0 = cheb.center;
  const centerWorld = q0.map((x, i) => x + origin[i]);

  // Dual points, merging coinciding planes. Sorting by one normal component
  // makes duplicate detection a short sweep instead of an all-pairs scan.
  const m = normals.length;
  const dualPts: Vec[] = [];
  const planes: SlicePlane[] = [];
  const planeLocalOffset: number[] = [];
  const dedupeTol = 1e-9;
  const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => normals[a][0] - normals[b][0]);
  const planeOf = new Int32Array(m).fill(-1);
  for (let oi = 0; oi < m; oi++) {
    const i = order[oi];
    if (planeOf[i] >= 0) continue;
    const pid = planes.length;
    planeOf[i] = pid;
    const e = local[i] - dot(normals[i], q0);
    planes.push({ normal: normals[i], offset: offsets[i], facets: [facetIds[i]], hiddenNormal: hiddenNormals[i] });
    planeLocalOffset.push(local[i]);
    dualPts.push(normals[i].map((x) => x / e));
    for (let oj = oi + 1; oj < m; oj++) {
      const j = order[oj];
      if (normals[j][0] - normals[i][0] > dedupeTol) break;
      if (planeOf[j] >= 0) continue;
      if (Math.abs(dot(normals[i], normals[j]) - 1) < dedupeTol && Math.abs(local[i] - local[j]) < dedupeTol * scale) {
        planeOf[j] = pid;
        planes[pid].facets.push(facetIds[j]);
      }
    }
  }

  const fallback = (): SliceResult => ({
    k,
    exact: false,
    planes,
    vertices: [],
    edges: [],
    faces: [],
    center: centerWorld,
    inradius: cheb.radius,
  });

  const vertTol = 1e-7 * scale;
  const toWorld = (v: Vec) => v.map((x, i) => x + origin[i]);

  if (k === 2) {
    const loop = convexHull2(dualPts);
    if (!loop) return fallback();
    const vertices: Vec[] = [];
    const vids: number[] = [];
    for (let j = 0; j < loop.length; j++) {
      const u = loop[j];
      const v = loop[(j + 1) % loop.length];
      const x = solve([planes[u].normal, planes[v].normal], [planeLocalOffset[u], planeLocalOffset[v]]);
      if (!x) return fallback();
      let id = vertices.findIndex((y) => Math.abs(y[0] - x[0]) < vertTol && Math.abs(y[1] - x[1]) < vertTol);
      if (id < 0) {
        id = vertices.length;
        vertices.push(x);
      }
      vids.push(id);
    }
    const faces: SliceFace[] = [];
    const edges: [number, number][] = [];
    for (let j = 0; j < loop.length; j++) {
      const a = vids[(j - 1 + loop.length) % loop.length];
      const b = vids[j];
      if (a === b) continue;
      faces.push({ ...planes[loop[j]], loop: [a, b] });
      edges.push([a, b]);
    }
    if (faces.length < 3) return fallback();
    return {
      k,
      exact: true,
      planes: faces.map(({ loop: _loop, ...pl }) => pl),
      vertices: vertices.map(toWorld),
      edges,
      faces,
      center: centerWorld,
      inradius: cheb.radius,
    };
  }

  // k === 3: each hull triangle (three dual points = three planes) is a polytope vertex.
  const hull = convexHull3(dualPts);
  if (!hull) return fallback();
  const T = hull.faces.length;
  const P = planes.length;
  const tv: Vec[] = new Array(T);
  for (let t = 0; t < T; t++) {
    const [u, v, w] = hull.faces[t];
    let x = solve(
      [planes[u].normal, planes[v].normal, planes[w].normal],
      [planeLocalOffset[u], planeLocalOffset[v], planeLocalOffset[w]],
    );
    if (!x) {
      // Fall back to the polar construction from the dual triangle's plane.
      const pu = dualPts[u];
      const nrm = cross3(sub(dualPts[v], pu), sub(dualPts[w], pu));
      const off = dot(nrm, pu);
      if (Math.abs(off) < 1e-300) return fallback();
      x = nrm.map((c, i) => c / off + q0[i]);
    }
    tv[t] = x;
  }

  // Coplanar dual triangles (several planes through one vertex) give the same
  // vertex: merge neighbouring triangles whose vertices coincide.
  const parent = new Int32Array(T);
  for (let t = 0; t < T; t++) parent[t] = t;
  const find = (t: number): number => {
    while (parent[t] !== t) {
      parent[t] = parent[parent[t]];
      t = parent[t];
    }
    return t;
  };
  const edgeOwner = new Map<number, number>();
  for (let t = 0; t < T; t++) {
    const f = hull.faces[t];
    for (let e = 0; e < 3; e++) {
      const u = f[e];
      const w = f[(e + 1) % 3];
      const twin = edgeOwner.get(w * P + u);
      if (twin === undefined) {
        edgeOwner.set(u * P + w, t);
        continue;
      }
      const a = tv[t];
      const b = tv[twin];
      if (Math.abs(a[0] - b[0]) < vertTol && Math.abs(a[1] - b[1]) < vertTol && Math.abs(a[2] - b[2]) < vertTol) {
        parent[find(t)] = find(twin);
      }
    }
  }
  const vertexOfRoot = new Int32Array(T).fill(-1);
  const vertices: Vec[] = [];
  const triVertex = new Int32Array(T);
  for (let t = 0; t < T; t++) {
    const root = find(t);
    if (vertexOfRoot[root] < 0) {
      vertexOfRoot[root] = vertices.length;
      vertices.push(tv[root]);
    }
    triVertex[t] = vertexOfRoot[root];
  }

  // Sanity: every vertex must satisfy every candidate constraint.
  const feasTol = 1e-6 * scale;
  for (const v of vertices) {
    const vx = v[0];
    const vy = v[1];
    const vz = v[2];
    for (let i = 0; i < m; i++) {
      const nrm = normals[i];
      if (nrm[0] * vx + nrm[1] * vy + nrm[2] * vz - local[i] > feasTol) return fallback();
    }
  }

  // Incidence straight from the hull: a triangle's three planes all touch its vertex.
  const planeVerts: number[][] = Array.from({ length: P }, () => []);
  for (let t = 0; t < T; t++) {
    const vid = triVertex[t];
    for (const pid of hull.faces[t]) {
      const list = planeVerts[pid];
      if (!list.includes(vid)) list.push(vid);
    }
  }

  const faces: SliceFace[] = [];
  const edgeSet = new Set<number>();
  const edges: [number, number][] = [];
  const usedPlanes: SlicePlane[] = [];
  for (let pid = 0; pid < P; pid++) {
    const on = planeVerts[pid];
    if (on.length < 3) continue;
    const pl = planes[pid];
    const loop = orderLoop(vertices, on, pl.normal);
    faces.push({ ...pl, loop });
    usedPlanes.push(pl);
    for (let j = 0; j < loop.length; j++) {
      const a = loop[j];
      const b = loop[(j + 1) % loop.length];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * 1048576 + hi;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([lo, hi]);
      }
    }
  }
  if (faces.length < 4 || vertices.length - edges.length + faces.length !== 2) return fallback();

  return {
    k,
    exact: true,
    planes: usedPlanes,
    vertices: vertices.map(toWorld),
    edges,
    faces,
    center: centerWorld,
    inradius: cheb.radius,
  };
}
