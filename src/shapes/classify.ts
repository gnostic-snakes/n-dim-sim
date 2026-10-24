/**
 * Put a name to the slice: "Regular octahedron", "Hexagonal prism",
 * "Polyhedron with 14 faces (8 triangles, 6 hexagons)", ...
 */
import type { SliceResult } from '../math/slice';
import { dist, dot, sub, type Vec } from '../math/vec';

export interface SliceDescription {
  name: string;
  detail: string;
  counts: { vertices: number; edges: number; faces: number };
  regular: boolean;
}

const POLYGON_NAMES: Record<number, string> = {
  3: 'triangle',
  4: 'quadrilateral',
  5: 'pentagon',
  6: 'hexagon',
  7: 'heptagon',
  8: 'octagon',
  9: 'nonagon',
  10: 'decagon',
  11: 'hendecagon',
  12: 'dodecagon',
};

const PREFIX: Record<number, string> = {
  3: 'Triangular',
  4: 'Square',
  5: 'Pentagonal',
  6: 'Hexagonal',
  7: 'Heptagonal',
  8: 'Octagonal',
  9: 'Nonagonal',
  10: 'Decagonal',
  11: 'Hendecagonal',
  12: 'Dodecagonal',
};

export function polygonName(sides: number): string {
  return POLYGON_NAMES[sides] ?? `${sides}-gon`;
}

function plural(count: number, word: string): string {
  if (count === 1) return `1 ${word}`;
  return `${count} ${word.endsWith('x') ? `${word}es` : `${word}s`}`;
}

const REL_TOL = 1e-5;
const allClose = (xs: number[]): boolean => {
  if (xs.length === 0) return true;
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return hi - lo <= REL_TOL * Math.max(hi, 1e-12);
};

function loopEdgeLengths(vs: Vec[], loop: number[]): number[] {
  return loop.map((a, i) => dist(vs[a], vs[loop[(i + 1) % loop.length]]));
}

function loopAngles(vs: Vec[], loop: number[]): number[] {
  return loop.map((b, i) => {
    const a = vs[loop[(i - 1 + loop.length) % loop.length]];
    const c = vs[loop[(i + 1) % loop.length]];
    const u = sub(a, vs[b]);
    const v = sub(c, vs[b]);
    return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / Math.sqrt(dot(u, u) * dot(v, v)))));
  });
}

function isRegularPolygon(vs: Vec[], loop: number[]): boolean {
  return allClose(loopEdgeLengths(vs, loop)) && allClose(loopAngles(vs, loop));
}

/** Name a convex polygon from its ordered vertices. */
export function describePolygonLoop(vs: Vec[], loop: number[]): { name: string; regular: boolean } {
  const n = loop.length;
  const sides = loopEdgeLengths(vs, loop);
  const angles = loopAngles(vs, loop);
  const regular = allClose(sides) && allClose(angles);
  if (n === 3) {
    if (regular) return { name: 'Equilateral triangle', regular };
    const right = angles.some((a) => Math.abs(a - Math.PI / 2) < 1e-5);
    const [a, b, c] = sides;
    const iso = allClose([a, b]) || allClose([b, c]) || allClose([a, c]);
    if (right && iso) return { name: 'Right isosceles triangle', regular };
    if (right) return { name: 'Right triangle', regular };
    if (iso) return { name: 'Isosceles triangle', regular };
    return { name: 'Triangle', regular };
  }
  if (n === 4) {
    const rightAngles = angles.every((a) => Math.abs(a - Math.PI / 2) < 1e-5);
    const equalSides = allClose(sides);
    if (rightAngles && equalSides) return { name: 'Square', regular: true };
    if (rightAngles) return { name: 'Rectangle', regular: false };
    if (equalSides) return { name: 'Rhombus', regular: false };
    const parallel = (i: number, j: number) => {
      const u = sub(vs[loop[(i + 1) % 4]], vs[loop[i]]);
      const v = sub(vs[loop[(j + 1) % 4]], vs[loop[j]]);
      return Math.abs(Math.abs(dot(u, v)) / Math.sqrt(dot(u, u) * dot(v, v)) - 1) < 1e-6;
    };
    const p02 = parallel(0, 2);
    const p13 = parallel(1, 3);
    if (p02 && p13) return { name: 'Parallelogram', regular: false };
    if (p02 || p13) return { name: 'Trapezoid', regular: false };
    if (allClose([sides[0], sides[1]]) && allClose([sides[2], sides[3]])) return { name: 'Kite', regular: false };
    if (allClose([sides[1], sides[2]]) && allClose([sides[3], sides[0]])) return { name: 'Kite', regular: false };
    return { name: 'Quadrilateral', regular: false };
  }
  const base = polygonName(n);
  return { name: regular ? `Regular ${base}` : base[0].toUpperCase() + base.slice(1), regular };
}

interface Signature {
  v: number;
  f: number;
  sizes: Map<number, number>;
  degrees: Map<number, number>;
}

const has = (s: Signature, entries: [number, number][]) =>
  s.sizes.size === entries.length && entries.every(([k, c]) => s.sizes.get(k) === c);

function namedPolyhedron(sig: Signature, regularFaces: boolean, uniformEdges: boolean, slice: SliceResult): string | null {
  const { v, f } = sig;
  const reg = regularFaces && uniformEdges;
  const R = (name: string) => (reg ? `Regular ${name.toLowerCase()}` : name);
  if (f === 4 && has(sig, [[3, 4]])) return R('Tetrahedron');
  if (f === 6 && has(sig, [[4, 6]]) && v === 8) {
    if (reg) return 'Cube';
    const rect = slice.faces.every((face) => loopAngles(slice.vertices, face.loop).every((a) => Math.abs(a - Math.PI / 2) < 1e-5));
    if (rect) return 'Cuboid';
    if (oppositeFacesParallel(slice) === 3) return 'Parallelepiped';
    return 'Hexahedron';
  }
  if (f === 8 && has(sig, [[3, 8]]) && v === 6) return R('Octahedron');
  if (f === 12 && has(sig, [[5, 12]]) && v === 20) return R('Dodecahedron');
  if (f === 20 && has(sig, [[3, 20]]) && v === 12) return R('Icosahedron');
  if (has(sig, [
    [3, 8],
    [4, 6],
  ]) && v === 12)
    return 'Cuboctahedron';
  if (has(sig, [
    [3, 20],
    [5, 12],
  ]) && v === 30)
    return 'Icosidodecahedron';
  if (has(sig, [
    [3, 4],
    [6, 4],
  ]) && v === 12)
    return 'Truncated tetrahedron';
  if (has(sig, [
    [4, 6],
    [6, 8],
  ]) && v === 24)
    return 'Truncated octahedron';
  if (has(sig, [
    [3, 8],
    [8, 6],
  ]) && v === 24)
    return 'Truncated cube';
  if (has(sig, [
    [3, 8],
    [4, 18],
  ]) && v === 24)
    return 'Rhombicuboctahedron';
  if (has(sig, [[3, 80]]) && v === 42 && sig.degrees.get(5) === 12 && sig.degrees.get(6) === 30)
    return 'Pentakis icosidodecahedron';
  if (has(sig, [[4, 12]]) && v === 14 && uniformEdges) return 'Rhombic dodecahedron';
  if (has(sig, [[4, 30]]) && v === 32 && uniformEdges) return 'Rhombic triacontahedron';

  // Prisms: 2 n-gons + n quadrilaterals, 2n vertices.
  for (const [k, c] of sig.sizes) {
    if (k === 4 || c !== 2) continue;
    if (has(sig, [
      [k, 2],
      [4, k],
    ]) && v === 2 * k)
      return `${PREFIX[k] ?? `${k}-gonal`} prism`;
    if (has(sig, [
      [k, 2],
      [3, 2 * k],
    ]) && v === 2 * k)
      return `${PREFIX[k] ?? `${k}-gonal`} antiprism`;
  }
  if (has(sig, [[4, 6]]) && v === 8) return 'Hexahedron';
  // Pyramids: 1 n-gon + n triangles.
  for (const [k, c] of sig.sizes) {
    if (k === 3 || c !== 1) continue;
    if (has(sig, [
      [k, 1],
      [3, k],
    ]) && v === k + 1)
      return `${PREFIX[k] ?? `${k}-gonal`} pyramid`;
  }
  if (has(sig, [[3, 6]]) && v === 5) return 'Triangular bipyramid';
  // Bipyramids: 2n triangles, n + 2 vertices, two apices of degree n.
  if (sig.sizes.size === 1 && sig.sizes.has(3) && v === f / 2 + 2 && f >= 8 && (sig.degrees.get(f / 2) ?? 0) >= 2) {
    const k = f / 2;
    return `${PREFIX[k] ?? `${k}-gonal`} bipyramid`;
  }
  return null;
}

function oppositeFacesParallel(slice: SliceResult): number {
  let pairs = 0;
  const used = new Set<number>();
  slice.faces.forEach((a, i) => {
    if (used.has(i)) return;
    slice.faces.forEach((b, j) => {
      if (j <= i || used.has(j) || used.has(i)) return;
      if (dot(a.normal, b.normal) < -1 + 1e-6) {
        used.add(i);
        used.add(j);
        pairs++;
      }
    });
  });
  return pairs;
}

export function describeSlice(slice: SliceResult): SliceDescription {
  const counts = { vertices: slice.vertices.length, edges: slice.edges.length, faces: slice.faces.length };
  if (!slice.exact) return { name: 'Slice', detail: '', counts, regular: false };
  if (slice.k === 2) {
    const loop = slice.faces.map((f) => f.loop[0]);
    const { name, regular } = describePolygonLoop(slice.vertices, loop);
    return { name, detail: `${loop.length} sides`, counts, regular };
  }
  const sizes = new Map<number, number>();
  for (const face of slice.faces) sizes.set(face.loop.length, (sizes.get(face.loop.length) ?? 0) + 1);
  const degrees = new Map<number, number>();
  const deg = new Array<number>(slice.vertices.length).fill(0);
  for (const [a, b] of slice.edges) {
    deg[a]++;
    deg[b]++;
  }
  for (const d of deg) degrees.set(d, (degrees.get(d) ?? 0) + 1);
  const edgeLengths = slice.edges.map(([a, b]) => dist(slice.vertices[a], slice.vertices[b]));
  const uniformEdges = allClose(edgeLengths);
  const regularFaces = slice.faces.every((face) => isRegularPolygon(slice.vertices, face.loop));
  const sig: Signature = { v: slice.vertices.length, f: slice.faces.length, sizes, degrees };
  const breakdown = [...sizes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, c]) => plural(c, polygonName(k)))
    .join(', ');
  const named = namedPolyhedron(sig, regularFaces, uniformEdges, slice);
  const regular = named !== null && named.startsWith('Regular') ? true : named === 'Cube';
  return {
    name: named ?? `Polyhedron with ${slice.faces.length} faces`,
    detail: breakdown,
    counts,
    regular,
  };
}
