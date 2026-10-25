/**
 * The design doc's correctness checks (section 9), plus cross-checks of the
 * slicer against brute force.
 */
import { describe, expect, it } from 'vitest';
import { applyPoint } from '../math/homogeneous';
import { sliceConvexPolytope, sliceAffineMap, restrictFacets, type SliceResult } from '../math/slice';
import { compileJS } from '../math/sdf';
import { composeStack, type TransformOpSpec } from '../math/transforms';
import { solve } from '../math/mat';
import { dist, dot, type Vec } from '../math/vec';
import { parsePlane } from '../math/axes';
import { describeSlice } from './classify';
import { cell120, cell24, cell600, crossPolytope, duoprism, hypercube, simplex, type PolytopeGeometry } from './polytopes';
import { getShape, scaledFacets, sdfValues } from './registry';
import type { SdfShapeDef } from './types';

const rot = (plane: string, angle: number): TransformOpSpec => ({ kind: 'rotate', plane: parsePlane(plane), angle });

function sliceOf(g: PolytopeGeometry, size: number, ops: TransformOpSpec[], hidden: number[]): SliceResult | null {
  const n = g.dim;
  const k = n >= 4 ? 3 : n - 1;
  const { inverse } = composeStack(n, ops);
  return sliceConvexPolytope({ facets: scaledFacets(g, size), inverse, hidden, k });
}

function edgeLengths(s: SliceResult): number[] {
  return s.edges.map(([a, b]) => dist(s.vertices[a], s.vertices[b]));
}

function faceSizes(s: SliceResult): number[] {
  return s.faces.map((f) => f.loop.length).sort((a, b) => a - b);
}

/** Tesseract rotated so its long diagonal (1,1,1,1) points along w. */
const diagonalToW: TransformOpSpec[] = [rot('zw', 45), rot('yw', (Math.atan(1 / Math.SQRT2) * 180) / Math.PI), rot('xw', 30)];

describe('correctness checks (design doc section 9)', () => {
  it('tesseract, no transform, slice at w = 0 -> a cube', () => {
    const s = sliceOf(hypercube(4), 2, [], [0])!;
    expect(s.exact).toBe(true);
    expect(s.vertices).toHaveLength(8);
    expect(s.edges).toHaveLength(12);
    expect(faceSizes(s)).toEqual([4, 4, 4, 4, 4, 4]);
    for (const l of edgeLengths(s)) expect(l).toBeCloseTo(2, 9);
    for (const v of s.vertices) for (const c of v) expect(Math.abs(c)).toBeCloseTo(1, 9);
    expect(describeSlice(s).name).toBe('Cube');
  });

  it('the rotation really sends (1,1,1,1) to the w axis', () => {
    const { matrix } = composeStack(4, diagonalToW);
    const d = applyPoint(matrix, [1, 1, 1, 1]);
    expect(d[0]).toBeCloseTo(0, 12);
    expect(d[1]).toBeCloseTo(0, 12);
    expect(d[2]).toBeCloseTo(0, 12);
    expect(d[3]).toBeCloseTo(2, 12);
  });

  it('tesseract sliced perpendicular to its long diagonal through the center -> a regular octahedron', () => {
    const s = sliceOf(hypercube(4), 2, diagonalToW, [0])!;
    expect(s.vertices).toHaveLength(6);
    expect(s.edges).toHaveLength(12);
    expect(faceSizes(s)).toEqual(new Array(8).fill(3));
    const ls = edgeLengths(s);
    for (const l of ls) expect(l).toBeCloseTo(ls[0], 9);
    expect(describeSlice(s).name).toBe('Regular octahedron');
  });

  it('the diagonal scan starts with a tetrahedron near a vertex', () => {
    const s = sliceOf(hypercube(4), 2, diagonalToW, [1.5])!;
    expect(describeSlice(s).name).toBe('Regular tetrahedron');
    const mid = sliceOf(hypercube(4), 2, diagonalToW, [0.5])!;
    expect(describeSlice(mid).name).toBe('Truncated tetrahedron');
  });

  it('16-cell, slice at w = 0 -> an octahedron', () => {
    const s = sliceOf(crossPolytope(4), 1, [], [0])!;
    expect(s.vertices).toHaveLength(6);
    expect(faceSizes(s)).toEqual(new Array(8).fill(3));
    expect(describeSlice(s).name).toBe('Regular octahedron');
    // Vertices are exactly +-e_x, +-e_y, +-e_z.
    for (const v of s.vertices) expect(Math.max(...v.map(Math.abs))).toBeCloseTo(1, 9);
  });

  it('24-cell, slice at w = 0 -> a cuboctahedron', () => {
    const s = sliceOf(cell24(), Math.SQRT2, [], [0])!;
    expect(s.vertices).toHaveLength(12);
    expect(s.edges).toHaveLength(24);
    expect(faceSizes(s)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4]);
    expect(describeSlice(s).name).toBe('Cuboctahedron');
  });

  it('hypersphere of radius r sliced at w = d -> sphere of radius sqrt(r^2 - d^2), nothing when |d| > r', () => {
    const def = getShape('ball') as SdfShapeDef;
    const f = compileJS(def.sdf(4, {}));
    const r = 1.5;
    const params = sdfValues(def, { r });
    for (const d of [0, 0.4, 1.2, 1.49]) {
      const rho = Math.sqrt(r * r - d * d);
      // On the predicted sphere the SDF vanishes; inside negative, outside positive.
      for (const dir of [
        [1, 0, 0],
        [0, 0.6, 0.8],
        [-0.48, 0.6, -0.64],
      ]) {
        const at = (t: number) => f([dir[0] * t, dir[1] * t, dir[2] * t, d], params);
        expect(at(rho)).toBeCloseTo(0, 9);
        expect(at(rho * 0.9)).toBeLessThan(0);
        expect(at(rho * 1.1)).toBeGreaterThan(0);
      }
    }
    // |d| > r: the SDF is positive everywhere on the slice (its minimum is at the slice's center).
    for (const d of [1.51, 2, -3]) expect(f([0, 0, 0, d], params)).toBeGreaterThan(0);
  });

  it('rotating a tesseract 90 degrees in xw gives a cube again at w = 0', () => {
    const s = sliceOf(hypercube(4), 2, [rot('xw', 90)], [0])!;
    expect(describeSlice(s).name).toBe('Cube');
    for (const l of edgeLengths(s)) expect(l).toBeCloseTo(2, 9);
    // ...whereas 45 degrees stretches it into a cuboid.
    const half = sliceOf(hypercube(4), 2, [rot('xw', 45)], [0])!;
    expect(describeSlice(half).name).toBe('Cuboid');
  });
});

describe('slicer details', () => {
  it('returns null for empty slices', () => {
    expect(sliceOf(hypercube(4), 2, [], [1.5])).toBeNull();
    expect(sliceOf(hypercube(4), 2, [], [-1.01])).toBeNull();
    expect(sliceOf(cell600(), 2, [], [2.01])).toBeNull();
  });

  it('slices the facet itself when the slice coincides with a cell', () => {
    const s = sliceOf(hypercube(4), 2, [], [1])!;
    expect(describeSlice(s).name).toBe('Cube');
  });

  it('600-cell equatorial slice is a pentakis icosidodecahedron', () => {
    // The 30 vertices at w = 0 form an icosidodecahedron, but 12 edges also cross w = 0
    // (between vertices at w = +-1/(2 phi)), capping each pentagon with a low pyramid.
    const s = sliceOf(cell600(), 1, [], [0])!;
    expect(s.exact).toBe(true);
    expect(s.vertices).toHaveLength(42);
    expect(s.edges).toHaveLength(120);
    expect(faceSizes(s)).toEqual(new Array(80).fill(3));
    expect(describeSlice(s).name).toBe('Pentakis icosidodecahedron');
  });

  it('120-cell slices are exact', () => {
    const s = sliceOf(cell120(), 1, [rot('xw', 17), rot('yz', 31)], [0.1])!;
    expect(s.exact).toBe(true);
    expect(s.vertices.length - s.edges.length + s.faces.length).toBe(2);
  });

  it('a 3,6-duoprism cut at w = 0 is a triangular prism', () => {
    const s = sliceOf(duoprism(3, 6), 1, [], [0])!;
    expect(describeSlice(s).name).toBe('Triangular prism');
  });

  it('the 5-cell has triangular-prism slices', () => {
    // Slice perpendicular to the line joining the midpoints of opposite edge and triangle.
    const g = simplex(4);
    const v = g.vertices;
    const edgeMid = v[0].map((x, i) => (x + v[1][i]) / 2);
    const triMid = v[2].map((x, i) => (x + v[3][i] + v[4][i]) / 3);
    const axis = edgeMid.map((x, i) => x - triMid[i]);
    // Rotate `axis` onto w with Givens rotations (zw, yw, xw).
    const ops: TransformOpSpec[] = [];
    let a = axis.slice();
    for (const [i, name] of [
      [2, 'zw'],
      [1, 'yw'],
      [0, 'xw'],
    ] as [number, string][]) {
      const theta = Math.atan2(a[i], a[3]);
      ops.push(rot(name, (theta * 180) / Math.PI));
      a = applyPoint(composeStack(4, [rot(name, (theta * 180) / Math.PI)]).matrix, a);
    }
    const s = sliceOf(g, 2, ops, [(dot(edgeMid, axis) / Math.hypot(...axis)) * 2 * 0.0])!;
    expect(describeSlice(s).name).toBe('Triangular prism');
  });

  it('works in Flatland: a cube sliced through its center along the long diagonal is a regular hexagon', () => {
    const g = hypercube(3);
    const ops = [rot('yz', 45), rot('xz', (Math.atan(1 / Math.SQRT2) * 180) / Math.PI)];
    const s = sliceOf(g, Math.sqrt(3), ops, [0])!;
    expect(s.k).toBe(2);
    expect(s.vertices).toHaveLength(6);
    expect(describeSlice(s).name).toBe('Regular hexagon');
    const sq = sliceOf(g, Math.sqrt(3), [], [0.3])!;
    expect(describeSlice(sq).name).toBe('Square');
  });

  it('works in 5D and beyond with several hidden axes', () => {
    // A penteract sliced at w = v = 0 is a cube.
    const s = sliceOf(hypercube(5), Math.sqrt(5), [], [0, 0])!;
    expect(describeSlice(s).name).toBe('Cube');
    // The 8-cube with rotations mixing all hidden axes still gives a valid polyhedron.
    const t = sliceOf(hypercube(8), 2, [rot('xw', 20), rot('yv', 35), rot('zu', 50), rot('xs', 15)], [0.1, -0.1, 0, 0, 0.05])!;
    expect(t.exact).toBe(true);
    expect(t.vertices.length - t.edges.length + t.faces.length).toBe(2);
  });

  it('matches a brute-force half-space intersection on random transforms', () => {
    let seed = 99;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const shapes: [PolytopeGeometry, number][] = [
      [hypercube(4), 2],
      [crossPolytope(4), 2],
      [cell24(), 2],
      [simplex(4), 2],
      [duoprism(5, 4), 2],
      [hypercube(5), 2],
    ];
    for (let trial = 0; trial < 60; trial++) {
      const [g, size] = shapes[trial % shapes.length];
      const n = g.dim;
      const planes = ['xw', 'yw', 'zw', 'xy', 'yz', 'xz', ...(n > 4 ? ['xv', 'wv', 'zv'] : [])];
      const ops: TransformOpSpec[] = [];
      for (let i = 0; i < 4; i++) ops.push(rot(planes[Math.floor(rand() * planes.length)], rand() * 360));
      ops.push({ kind: 'scale', axis: Math.floor(rand() * n), factor: 0.5 + rand() });
      ops.push({ kind: 'translate', axis: 3, amount: (rand() - 0.5) * 1.5 });
      const hidden = new Array(n - 3).fill(0).map(() => (rand() - 0.5) * 0.8);
      const s = sliceOf(g, size, ops, hidden);
      const brute = bruteForceVertices(g, size, ops, hidden);
      if (brute.length === 0) {
        expect(s).toBeNull();
        continue;
      }
      expect(s).not.toBeNull();
      expect(s!.exact).toBe(true);
      expect(s!.vertices.length).toBe(brute.length);
      for (const b of brute) expect(Math.min(...s!.vertices.map((v) => dist(v, b)))).toBeLessThan(1e-6);
      expect(s!.vertices.length - s!.edges.length + s!.faces.length).toBe(2);
    }
  });
});

/** All feasible intersections of three restricted planes, deduplicated. */
function bruteForceVertices(g: PolytopeGeometry, size: number, ops: TransformOpSpec[], hidden: number[]): Vec[] {
  const n = g.dim;
  const { inverse } = composeStack(n, ops);
  const r = restrictFacets({ facets: scaledFacets(g, size), inverse, hidden, k: 3 });
  void sliceAffineMap;
  if (r.empty) return [];
  const m = r.normals.length;
  const out: Vec[] = [];
  for (let a = 0; a < m; a++)
    for (let b = a + 1; b < m; b++)
      for (let c = b + 1; c < m; c++) {
        const x = solve([r.normals[a], r.normals[b], r.normals[c]], [r.offsets[a], r.offsets[b], r.offsets[c]]);
        if (!x) continue;
        let ok = true;
        for (let i = 0; i < m && ok; i++) if (dot(r.normals[i], x) > r.offsets[i] + 1e-9) ok = false;
        if (!ok) continue;
        if (out.some((y) => dist(x, y) < 1e-7)) continue;
        out.push(x);
      }
  // A slice with no interior (fewer than 4 non-coplanar vertices) counts as empty.
  if (out.length < 4) return [];
  return out;
}
