/**
 * Convex polytope generators. Every polytope is centred on the origin and
 * returned at unit circumradius; the shape's `size` parameter scales it.
 */
import { dist, dot, norm, normalize, scale, zeros, type Vec } from '../math/vec';
import type { Facet } from '../math/slice';

export interface PolytopeGeometry {
  dim: number;
  vertices: Vec[];
  edges: [number, number][];
  facets: Facet[];
  /** Vertex indices lying on each facet (same order as `facets`). */
  facetVertices: number[][];
  /** Face counts f_0 .. f_{n-1} (vertices, edges, 2-faces, cells, ...). */
  faceCounts: number[];
  circumradius: number;
  inradius: number;
}

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/** Edges = vertex pairs at the minimum pairwise distance (true for all uniform polytopes here). */
function edgesByMinDistance(vertices: Vec[], relTol = 1e-6): [number, number][] {
  let min = Infinity;
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++) min = Math.min(min, dist(vertices[i], vertices[j]));
  const edges: [number, number][] = [];
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++)
      if (dist(vertices[i], vertices[j]) < min * (1 + relTol)) edges.push([i, j]);
  return edges;
}

function incidence(vertices: Vec[], facets: Facet[], tol = 1e-7): number[][] {
  return facets.map((f) => {
    const on: number[] = [];
    vertices.forEach((v, i) => {
      if (Math.abs(dot(f.normal, v) - f.offset) < tol) on.push(i);
    });
    return on;
  });
}

function finish(
  dim: number,
  vertices: Vec[],
  edges: [number, number][],
  facets: Facet[],
  faceCounts: number[],
): PolytopeGeometry {
  // Normalize to unit circumradius.
  let r = 0;
  for (const v of vertices) r = Math.max(r, norm(v));
  const s = 1 / r;
  const vs = vertices.map((v) => scale(v, s));
  const fs = facets.map((f) => ({ normal: normalize(f.normal), offset: (f.offset / norm(f.normal)) * s }));
  let inr = Infinity;
  for (const f of fs) inr = Math.min(inr, f.offset);
  return {
    dim,
    vertices: vs,
    edges,
    facets: fs,
    facetVertices: incidence(vs, fs),
    faceCounts,
    circumradius: 1,
    inradius: inr,
  };
}

/** n-cube (hypercube): vertices (+-1, ..., +-1), facets |x_i| <= 1. */
export function hypercube(n: number): PolytopeGeometry {
  const vertices: Vec[] = [];
  for (let m = 0; m < 1 << n; m++) {
    const v: Vec = [];
    for (let i = 0; i < n; i++) v.push(m & (1 << i) ? 1 : -1);
    vertices.push(v);
  }
  const edges: [number, number][] = [];
  for (let m = 0; m < 1 << n; m++)
    for (let i = 0; i < n; i++) {
      const o = m ^ (1 << i);
      if (o > m) edges.push([m, o]);
    }
  const facets: Facet[] = [];
  for (let i = 0; i < n; i++) {
    for (const s of [1, -1]) {
      const normal = zeros(n);
      normal[i] = s;
      facets.push({ normal, offset: 1 });
    }
  }
  const counts: number[] = [];
  for (let k = 0; k < n; k++) counts.push(2 ** (n - k) * binom(n, k));
  return finish(n, vertices, edges, facets, counts);
}

/** n-cross-polytope (orthoplex): vertices +-e_i, facets (+-x_1 +- ... +- x_n) <= 1. */
export function crossPolytope(n: number): PolytopeGeometry {
  const vertices: Vec[] = [];
  for (let i = 0; i < n; i++)
    for (const s of [1, -1]) {
      const v = zeros(n);
      v[i] = s;
      vertices.push(v);
    }
  const edges: [number, number][] = [];
  for (let a = 0; a < vertices.length; a++)
    for (let b = a + 1; b < vertices.length; b++) if (a >> 1 !== b >> 1) edges.push([a, b]);
  const facets: Facet[] = [];
  for (let m = 0; m < 1 << n; m++) {
    const normal: Vec = [];
    for (let i = 0; i < n; i++) normal.push(m & (1 << i) ? -1 : 1);
    facets.push({ normal, offset: 1 });
  }
  const counts: number[] = [];
  for (let k = 0; k < n; k++) counts.push(2 ** (k + 1) * binom(n, k + 1));
  return finish(n, vertices, edges, facets, counts);
}

/** Regular n-simplex: n + 1 mutually equidistant vertices. */
export function simplex(n: number): PolytopeGeometry {
  // Start from e_0..e_n in R^{n+1}, centre them, then express in an orthonormal
  // basis of the hyperplane sum(x) = 0 (Helmert basis).
  const basis: Vec[] = [];
  for (let k = 1; k <= n; k++) {
    const b = zeros(n + 1);
    for (let i = 0; i < k; i++) b[i] = 1;
    b[k] = -k;
    basis.push(normalize(b));
  }
  const vertices: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const e = zeros(n + 1);
    e[i] = 1;
    const c = e.map((x) => x - 1 / (n + 1));
    vertices.push(basis.map((b) => dot(b, c)));
  }
  const edges: [number, number][] = [];
  for (let a = 0; a <= n; a++) for (let b = a + 1; b <= n; b++) edges.push([a, b]);
  // The facet opposite vertex v has outward normal -v; with circumradius R its distance is R / n.
  const R = norm(vertices[0]);
  const facets: Facet[] = vertices.map((v) => ({ normal: scale(v, -1 / R), offset: R / n }));
  const counts: number[] = [];
  for (let k = 0; k < n; k++) counts.push(binom(n + 1, k + 1));
  return finish(n, vertices, edges, facets, counts);
}

/** 24-cell: all permutations of (+-1, +-1, 0, 0). */
export function cell24(): PolytopeGeometry {
  const vertices: Vec[] = [];
  for (let a = 0; a < 4; a++)
    for (let b = a + 1; b < 4; b++)
      for (const sa of [1, -1])
        for (const sb of [1, -1]) {
          const v = zeros(4);
          v[a] = sa;
          v[b] = sb;
          vertices.push(v);
        }
  const facets: Facet[] = [];
  for (let i = 0; i < 4; i++)
    for (const s of [1, -1]) {
      const normal = zeros(4);
      normal[i] = s;
      facets.push({ normal, offset: 1 });
    }
  for (let m = 0; m < 16; m++) {
    const normal: Vec = [];
    for (let i = 0; i < 4; i++) normal.push(m & (1 << i) ? -0.5 : 0.5);
    facets.push({ normal, offset: 1 });
  }
  return finish(4, vertices, edgesByMinDistance(vertices), facets, [24, 96, 96, 24]);
}

const PHI = (1 + Math.sqrt(5)) / 2;

/** Even permutations of 4 elements. */
function evenPermutations4(): number[][] {
  const out: number[][] = [];
  const perm = (arr: number[], l: number) => {
    if (l === arr.length) {
      // parity by counting inversions
      let inv = 0;
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if (arr[i] > arr[j]) inv++;
      if (inv % 2 === 0) out.push(arr.slice());
      return;
    }
    for (let i = l; i < arr.length; i++) {
      [arr[l], arr[i]] = [arr[i], arr[l]];
      perm(arr, l + 1);
      [arr[l], arr[i]] = [arr[i], arr[l]];
    }
  };
  perm([0, 1, 2, 3], 0);
  return out;
}

function vertices600(): Vec[] {
  const vs: Vec[] = [];
  // 8 of the form +-e_i
  for (let i = 0; i < 4; i++)
    for (const s of [1, -1]) {
      const v = zeros(4);
      v[i] = s;
      vs.push(v);
    }
  // 16 of the form (+-1/2, +-1/2, +-1/2, +-1/2)
  for (let m = 0; m < 16; m++) {
    const v: Vec = [];
    for (let i = 0; i < 4; i++) v.push(m & (1 << i) ? -0.5 : 0.5);
    vs.push(v);
  }
  // 96 from even permutations of 1/2 (+-phi, +-1, +-1/phi, 0)
  const base = [PHI / 2, 0.5, 1 / (2 * PHI), 0];
  for (const p of evenPermutations4()) {
    for (let m = 0; m < 8; m++) {
      const vals = [m & 1 ? -base[0] : base[0], m & 2 ? -base[1] : base[1], m & 4 ? -base[2] : base[2], 0];
      const v = zeros(4);
      for (let i = 0; i < 4; i++) v[p[i]] = vals[i];
      vs.push(v);
    }
  }
  return vs;
}

/** All 4-cliques of an edge graph (the tetrahedral cells of the 600-cell). */
function fourCliques(nv: number, edges: [number, number][]): number[][] {
  const adj: Set<number>[] = Array.from({ length: nv }, () => new Set<number>());
  for (const [a, b] of edges) {
    adj[a].add(b);
    adj[b].add(a);
  }
  const out: number[][] = [];
  for (let a = 0; a < nv; a++)
    for (const b of adj[a]) {
      if (b <= a) continue;
      for (const c of adj[b]) {
        if (c <= b || !adj[a].has(c)) continue;
        for (const d of adj[c]) {
          if (d <= c || !adj[a].has(d) || !adj[b].has(d)) continue;
          out.push([a, b, c, d]);
        }
      }
    }
  return out;
}

let cached600: PolytopeGeometry | null = null;
let cached120: PolytopeGeometry | null = null;

/** 600-cell: 120 vertices, 720 edges, 1200 triangles, 600 tetrahedral cells. */
export function cell600(): PolytopeGeometry {
  if (cached600) return cached600;
  const vertices = vertices600();
  const edges = edgesByMinDistance(vertices);
  const cells = fourCliques(vertices.length, edges);
  const facets: Facet[] = cells.map((cell) => {
    const c = zeros(4);
    for (const i of cell) for (let d = 0; d < 4; d++) c[d] += vertices[i][d] / 4;
    // By symmetry the cell centroid direction is its normal; its length is the facet's distance.
    return { normal: normalize(c), offset: norm(c) };
  });
  cached600 = finish(4, vertices, edges, facets, [120, 720, 1200, 600]);
  return cached600;
}

/** 120-cell: the dual of the 600-cell. 600 vertices, 1200 edges, 720 pentagons, 120 dodecahedral cells. */
export function cell120(): PolytopeGeometry {
  if (cached120) return cached120;
  const c600 = cell600();
  // Polar dual: facet normals are the 600-cell's vertex directions; vertices are
  // the 600-cell's facet normals divided by their distances.
  const vertices = c600.facets.map((f) => scale(f.normal, 1 / f.offset));
  const facets: Facet[] = c600.vertices.map((v) => ({ normal: normalize(v), offset: 1 }));
  cached120 = finish(4, vertices, edgesByMinDistance(vertices), facets, [600, 1200, 720, 120]);
  return cached120;
}

/**
 * p,q-duoprism: the product of a regular p-gon (in the xy-plane) and a regular
 * q-gon (in the zw-plane). Both polygons get the same circumradius.
 */
export function duoprism(p: number, q: number): PolytopeGeometry {
  const vertices: Vec[] = [];
  for (let i = 0; i < p; i++)
    for (let j = 0; j < q; j++) {
      const a = (2 * Math.PI * i) / p;
      const b = (2 * Math.PI * j) / q;
      vertices.push([Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)]);
    }
  const id = (i: number, j: number) => ((i + p) % p) * q + ((j + q) % q);
  const edges: [number, number][] = [];
  for (let i = 0; i < p; i++)
    for (let j = 0; j < q; j++) {
      const v = id(i, j);
      const a = id(i + 1, j);
      const b = id(i, j + 1);
      edges.push(v < a ? [v, a] : [a, v]);
      edges.push(v < b ? [v, b] : [b, v]);
    }
  const facets: Facet[] = [];
  for (let i = 0; i < p; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / p;
    facets.push({ normal: [Math.cos(a), Math.sin(a), 0, 0], offset: Math.cos(Math.PI / p) });
  }
  for (let j = 0; j < q; j++) {
    const b = (2 * Math.PI * (j + 0.5)) / q;
    facets.push({ normal: [0, 0, Math.cos(b), Math.sin(b)], offset: Math.cos(Math.PI / q) });
  }
  // f-vector of a p,q-duoprism: V = pq, E = 2pq, F = pq + p + q, C = p + q
  return finish(4, vertices, edges, facets, [p * q, 2 * p * q, p * q + p + q, p + q]);
}

/** Right prism over a 3D convex polyhedron, extruded along w with half-height h (before normalization). */
export function polyhedralPrism(base: { vertices: Vec[]; facets: Facet[] }, halfHeight: number, counts: number[]): PolytopeGeometry {
  const vertices: Vec[] = [];
  for (const s of [1, -1]) for (const v of base.vertices) vertices.push([v[0], v[1], v[2], s * halfHeight]);
  const facets: Facet[] = base.facets.map((f) => ({ normal: [...f.normal, 0], offset: f.offset }));
  facets.push({ normal: [0, 0, 0, 1], offset: halfHeight }, { normal: [0, 0, 0, -1], offset: halfHeight });
  const nb = base.vertices.length;
  const baseEdges = edgesByMinDistance(base.vertices);
  const edges: [number, number][] = [];
  for (const [a, b] of baseEdges) {
    edges.push([a, b], [a + nb, b + nb]);
  }
  for (let i = 0; i < nb; i++) edges.push([i, i + nb]);
  return finish(4, vertices, edges, facets, counts);
}
