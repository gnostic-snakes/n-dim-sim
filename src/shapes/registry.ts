/**
 * The shape library: every shape the app can place in a scene.
 *
 * Polytopes provide exact vertices/edges/facets (unit circumradius, scaled by
 * the `size` parameter). Curved shapes provide an n-D signed distance
 * expression plus a wireframe for the projected context view.
 */
import { E, type Expr } from '../math/sdf';
import { addScaled, basis, scale, type Vec } from '../math/vec';
import { dodecahedronVertices, hullFacets3, icosahedronVertices } from './polyhedra';
import {
  cell120,
  cell24,
  cell600,
  crossPolytope,
  duoprism,
  hypercube,
  polyhedralPrism,
  simplex,
  type PolytopeGeometry,
} from './polytopes';
import type { PolytopeShapeDef, SdfShapeDef, ShapeCount, ShapeDef, ShapeParamDef, SurfaceShapeDef } from './types';
import { axisCircle, circle, parametricGrid, sphereDirections } from './wire';

const sizeParam = (def = 2): ShapeParamDef => ({
  key: 'size',
  label: 'Size',
  min: 0.2,
  max: 4,
  step: 0.01,
  default: def,
  hint: 'Circumradius: the distance from the center to every vertex.',
});

const geometryCache = new Map<string, PolytopeGeometry>();
function cached(key: string, build: () => PolytopeGeometry): PolytopeGeometry {
  let g = geometryCache.get(key);
  if (!g) {
    g = build();
    geometryCache.set(key, g);
  }
  return g;
}

const FACE_NAMES = ['Vertices', 'Edges', 'Faces', 'Cells'];
export function faceCountLabels(counts: number[]): ShapeCount[] {
  return counts.map((value, k) => ({ label: FACE_NAMES[k] ?? `${k}-faces`, value }));
}

const dimLabel = (n: number) => `${n}D`;

// ---------------------------------------------------------------- polytopes

const simplexDef: PolytopeShapeDef = {
  id: 'simplex',
  kind: 'polytope',
  category: 'family',
  dims: (n) => n >= 3,
  name: (n) => (n === 3 ? 'Tetrahedron' : n === 4 ? '5-cell' : `${n}-simplex`),
  params: [sizeParam()],
  geometry: (n) => cached(`simplex${n}`, () => simplex(n)),
  boundingRadius: (_n, p) => p.size,
  info: (n) => {
    const counts = faceCountLabels(simplexDef.geometry(n, {}).faceCounts);
    if (n === 3)
      return {
        symbol: '{3,3}',
        counts,
        description: 'The simplest solid in 3D: four triangular faces, every vertex joined to every other.',
        funFact: 'A plane slicing a tetrahedron gives a triangle or a quadrilateral, depending on how many vertices end up on each side.',
      };
    if (n === 4)
      return {
        symbol: '{3,3,3}',
        counts,
        description:
          'The 4D tetrahedron (also called the 4-simplex or pentachoron). Five vertices, each one connected to all the others; its boundary is five tetrahedra.',
        funFact:
          'Its 3D slices are tetrahedra near a vertex, but can become triangular prisms in the middle: a shape with more faces than the tetrahedral cells it came from.',
      };
    return {
      counts,
      description: `The ${n}-simplex: ${n + 1} mutually equidistant vertices. It is the simplest possible solid in ${dimLabel(n)}.`,
      funFact: `Its edge graph is the complete graph on ${n + 1} vertices.`,
    };
  },
};

const HYPERCUBE_NAMES: Record<number, string> = {
  3: 'Cube',
  4: 'Tesseract',
  5: 'Penteract',
  6: 'Hexeract',
  7: 'Hepteract',
  8: 'Octeract',
};

const hypercubeDef: PolytopeShapeDef = {
  id: 'hypercube',
  kind: 'polytope',
  category: 'family',
  dims: (n) => n >= 3,
  name: (n) => HYPERCUBE_NAMES[n] ?? `${n}-cube`,
  params: [sizeParam()],
  geometry: (n) => cached(`cube${n}`, () => hypercube(n)),
  boundingRadius: (_n, p) => p.size,
  info: (n) => {
    const counts = faceCountLabels(hypercubeDef.geometry(n, {}).faceCounts);
    if (n === 3)
      return {
        symbol: '{4,3}',
        counts,
        description: 'Six square faces. Sweep a square along a third direction and you get a cube.',
        funFact: 'Slice a cube perpendicular to its long diagonal, right through the middle, and you get a regular hexagon.',
      };
    if (n === 4)
      return {
        symbol: '{4,3,3}',
        counts,
        description:
          'The 4D cube. Sweep a cube along the w-axis, just as sweeping a square makes a cube. Its boundary is 8 cubes, glued face to face.',
        funFact:
          'Slice a tesseract perpendicular to its long diagonal (1,1,1,1) through the center and you get a regular octahedron. Try the "Tesseract: diagonal scan" preset.',
      };
    return {
      counts,
      description: `The ${n}-cube: all ${2 ** n} points (±1, …, ±1), scaled. Its ${2 * n} facets are ${n - 1}-cubes.`,
      funFact: `Every vertex has exactly ${n} edges, one along each axis.`,
    };
  },
};

const CROSS_NAMES: Record<number, string> = {
  3: 'Octahedron',
  4: '16-cell',
};

const crossDef: PolytopeShapeDef = {
  id: 'cross',
  kind: 'polytope',
  category: 'family',
  dims: (n) => n >= 3,
  name: (n) => CROSS_NAMES[n] ?? `${n}-orthoplex`,
  params: [sizeParam()],
  geometry: (n) => cached(`cross${n}`, () => crossPolytope(n)),
  boundingRadius: (_n, p) => p.size,
  info: (n) => {
    const counts = faceCountLabels(crossDef.geometry(n, {}).faceCounts);
    if (n === 3)
      return {
        symbol: '{3,4}',
        counts,
        description: 'Eight triangles, with a vertex at ±1 on each axis. It is the dual of the cube.',
        funFact: 'Put a dot in the middle of each face of a cube and connect neighbours: you get an octahedron.',
      };
    if (n === 4)
      return {
        symbol: '{3,3,4}',
        counts,
        description:
          'The 4D octahedron (hexadecachoron): one vertex at ±1 on each of the four axes. Its boundary is 16 tetrahedra. It is the dual of the tesseract.',
        funFact: 'Its slice at w = 0 is a regular octahedron, and copies of the 16-cell can fill 4D space with no gaps.',
      };
    return {
      counts,
      description: `The ${n}-dimensional cross-polytope: ${2 * n} vertices at ±1 on each axis, and ${2 ** n} simplex facets. It is the dual of the ${n}-cube.`,
      funFact: 'Every vertex is joined to every other vertex except its own opposite.',
    };
  },
};

const cell24Def: PolytopeShapeDef = {
  id: 'cell24',
  kind: 'polytope',
  category: 'regular',
  dims: (n) => n === 4,
  name: () => '24-cell',
  params: [sizeParam()],
  geometry: () => cell24(),
  boundingRadius: (_n, p) => p.size,
  info: () => ({
    symbol: '{3,4,3}',
    counts: faceCountLabels(cell24().faceCounts),
    description:
      'Twenty-four octahedral cells. Its vertices are all the ways to place two ±1s among four coordinates. It has no analogue in any other dimension.',
    funFact:
      'Apart from simplices, it is the only regular polytope in 3 or more dimensions that is its own dual. Slice it at w = 0 and you get a cuboctahedron.',
  }),
};

const cell600Def: PolytopeShapeDef = {
  id: 'cell600',
  kind: 'polytope',
  category: 'regular',
  dims: (n) => n === 4,
  name: () => '600-cell',
  params: [sizeParam()],
  geometry: () => cell600(),
  boundingRadius: (_n, p) => p.size,
  info: () => ({
    symbol: '{3,3,5}',
    counts: faceCountLabels(cell600().faceCounts),
    description:
      'Six hundred tetrahedra, twenty around every vertex: the 4D cousin of the icosahedron. Its 120 vertex coordinates involve the golden ratio φ.',
    funFact: 'Read as quaternions, its 120 vertices form a group: the binary icosahedral group.',
  }),
};

const cell120Def: PolytopeShapeDef = {
  id: 'cell120',
  kind: 'polytope',
  category: 'regular',
  dims: (n) => n === 4,
  name: () => '120-cell',
  params: [sizeParam()],
  geometry: () => cell120(),
  boundingRadius: (_n, p) => p.size * cell120().circumradius,
  info: () => ({
    symbol: '{5,3,3}',
    counts: faceCountLabels(cell120().faceCounts),
    description:
      'One hundred twenty dodecahedra, three around every edge: the 4D cousin of the dodecahedron, and the dual of the 600-cell.',
    funFact: 'With 600 vertices it is the largest of the six regular 4D polytopes.',
  }),
};

const duoprismDef: PolytopeShapeDef = {
  id: 'duoprism',
  kind: 'polytope',
  category: 'prism',
  dims: (n) => n === 4,
  name: (_n, o) => `${o.p},${o.q}-duoprism`,
  params: [sizeParam()],
  options: [
    { key: 'p', label: 'p (xy polygon)', min: 3, max: 16, default: 3 },
    { key: 'q', label: 'q (zw polygon)', min: 3, max: 16, default: 6 },
  ],
  geometry: (_n, o) => cached(`duoprism${o.p},${o.q}`, () => duoprism(o.p, o.q)),
  boundingRadius: (_n, p) => p.size,
  info: (_n, o) => ({
    counts: faceCountLabels(duoprismDef.geometry(4, o).faceCounts),
    description: `A ${o.p}-gon in the xy-plane times a ${o.q}-gon in the zw-plane: every point pairs a point of one polygon with a point of the other. Its cells are ${o.p} ${o.q}-gonal prisms and ${o.q} ${o.p}-gonal prisms.`,
    funFact: 'The 4,4-duoprism is the tesseract, and as p and q grow, duoprisms approach the duocylinder.',
  }),
};

function uniformPrism(base: Vec[], f3: number, e3: number): PolytopeGeometry {
  // Normalize base to unit circumradius, then use half-height = edge / 2 so all edges are equal.
  let r = 0;
  for (const v of base) r = Math.max(r, Math.hypot(...v));
  const vs = base.map((v) => scale(v, 1 / r));
  let edge = Infinity;
  for (let i = 0; i < vs.length; i++)
    for (let j = i + 1; j < vs.length; j++) edge = Math.min(edge, Math.hypot(...vs[i].map((x, k) => x - vs[j][k])));
  const v3 = vs.length;
  return polyhedralPrism({ vertices: vs, facets: hullFacets3(vs) }, edge / 2, [2 * v3, 2 * e3 + v3, 2 * f3 + e3, 2 + f3]);
}

const PRISM_BASES: Record<number, { name: string; build: () => PolytopeGeometry }> = {
  0: { name: 'Tetrahedral prism', build: () => uniformPrism(simplex(3).vertices, 4, 6) },
  1: { name: 'Octahedral prism', build: () => uniformPrism(crossPolytope(3).vertices, 8, 12) },
  2: { name: 'Icosahedral prism', build: () => uniformPrism(icosahedronVertices(), 20, 30) },
  3: { name: 'Dodecahedral prism', build: () => uniformPrism(dodecahedronVertices(), 12, 30) },
};

const prismDef: PolytopeShapeDef = {
  id: 'prism',
  kind: 'polytope',
  category: 'prism',
  dims: (n) => n === 4,
  name: (_n, o) => PRISM_BASES[o.base]?.name ?? 'Polyhedral prism',
  params: [sizeParam()],
  options: [{ key: 'base', label: 'Base (0 tetra, 1 octa, 2 icosa, 3 dodeca)', min: 0, max: 3, default: 0 }],
  geometry: (_n, o) => cached(`prism${o.base}`, () => (PRISM_BASES[o.base] ?? PRISM_BASES[0]).build()),
  boundingRadius: (_n, p) => p.size,
  info: (_n, o) => ({
    counts: faceCountLabels(prismDef.geometry(4, o).faceCounts),
    description:
      'A 3D polyhedron extruded along the w-axis: two copies of the polyhedron (at w = ±h) joined by prisms over each face.',
    funFact: 'Unrotated, every slice is just the base polyhedron. Rotate it into w and the slice starts to stretch and grow new faces.',
  }),
};

const platonic3D: PolytopeShapeDef[] = [
  {
    id: 'dodecahedron',
    kind: 'polytope',
    category: 'flatland',
    dims: (n) => n === 3,
    name: () => 'Dodecahedron',
    params: [sizeParam()],
    geometry: () =>
      cached('dodecahedron', () => {
        const vs = dodecahedronVertices();
        return polyhedronGeometry(vs, [20, 30, 12]);
      }),
    boundingRadius: (_n, p) => p.size,
    info: () => ({
      symbol: '{5,3}',
      counts: faceCountLabels([20, 30, 12]),
      description: 'Twelve regular pentagons, three meeting at each vertex.',
      funFact: 'Slice it through the middle, parallel to two opposite faces, and you get a regular decagon.',
    }),
  },
  {
    id: 'icosahedron',
    kind: 'polytope',
    category: 'flatland',
    dims: (n) => n === 3,
    name: () => 'Icosahedron',
    params: [sizeParam()],
    geometry: () => cached('icosahedron', () => polyhedronGeometry(icosahedronVertices(), [12, 30, 20])),
    boundingRadius: (_n, p) => p.size,
    info: () => ({
      symbol: '{3,5}',
      counts: faceCountLabels([12, 30, 20]),
      description: 'Twenty equilateral triangles, five meeting at each vertex. It is the dual of the dodecahedron.',
      funFact: 'Its 12 vertices are the corners of three golden rectangles, set perpendicular to one another.',
    }),
  },
];

function polyhedronGeometry(vertices: Vec[], counts: number[]): PolytopeGeometry {
  let r = 0;
  for (const v of vertices) r = Math.max(r, Math.hypot(...v));
  const vs = vertices.map((v) => scale(v, 1 / r));
  const facets = hullFacets3(vs);
  let edgeLen = Infinity;
  for (let i = 0; i < vs.length; i++)
    for (let j = i + 1; j < vs.length; j++) edgeLen = Math.min(edgeLen, Math.hypot(...vs[i].map((x, k) => x - vs[j][k])));
  const edges: [number, number][] = [];
  for (let i = 0; i < vs.length; i++)
    for (let j = i + 1; j < vs.length; j++)
      if (Math.hypot(...vs[i].map((x, k) => x - vs[j][k])) < edgeLen * 1.000001) edges.push([i, j]);
  let inr = Infinity;
  for (const f of facets) inr = Math.min(inr, f.offset);
  return {
    dim: 3,
    vertices: vs,
    edges,
    facets,
    facetVertices: facets.map((f) => vs.flatMap((v, i) => (Math.abs(v[0] * f.normal[0] + v[1] * f.normal[1] + v[2] * f.normal[2] - f.offset) < 1e-7 ? [i] : []))),
    faceCounts: counts,
    circumradius: 1,
    inradius: inr,
  };
}

// ---------------------------------------------------------------- curved shapes

const x = E.x;
const p = E.p;

function ballWire(n: number, r: number): Vec[][] {
  const lines: Vec[][] = [];
  if (n === 4) {
    // Great circles through the slice space and meridians into w...
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
      [0, 3],
      [1, 3],
      [2, 3],
    ])
      lines.push(axisCircle(4, a, b, r));
    // ...plus "latitude spheres" at several w levels.
    for (const w of [-0.85, -0.5, 0.5, 0.85]) {
      const rr = r * Math.sqrt(1 - w * w);
      const c = [0, 0, 0, w * r];
      for (const [a, b] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ])
        lines.push(axisCircle(4, a, b, rr, c));
    }
    return lines;
  }
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) lines.push(axisCircle(n, a, b, r));
  if (n === 3) {
    for (const z of [-0.7, -0.35, 0.35, 0.7]) lines.push(axisCircle(3, 0, 1, r * Math.sqrt(1 - z * z), [0, 0, z * r]));
  }
  return lines;
}

const ballDef: SdfShapeDef = {
  id: 'ball',
  kind: 'sdf',
  category: 'family',
  dims: (n) => n >= 3,
  name: (n) => (n === 3 ? 'Sphere' : 'Hypersphere'),
  params: [{ key: 'r', label: 'Radius', min: 0.1, max: 3, step: 0.01, default: 1.5 }],
  sdf: (n) => E.sub(E.len(...E.xs(0, n)), p('r')),
  boundingRadius: (_n, q) => q.r,
  wireframe: (n, q) => ballWire(n, q.r),
  info: (n) =>
    n === 3
      ? {
          description: 'All points within distance r of the center.',
          funFact: 'A sphere passing through Flatland appears as a dot that grows into a circle, then shrinks and vanishes.',
        }
      : {
          description: `All points within distance r of the center, in ${dimLabel(n)}. Every 3D slice of it is a ball (or nothing at all). Strictly speaking this solid is the ${n}-ball; its surface is the ${n - 1}-sphere.`,
          funFact:
            'If a hypersphere drifted through our space we would see a point appear, swell into a sphere, shrink and vanish, exactly like a sphere passing through Flatland.',
        },
};

function torusGrid4(r1: number, r2: number, count = 16): Vec[][] {
  const lines: Vec[][] = [];
  for (let j = 0; j < count; j++) {
    const b = (2 * Math.PI * j) / count;
    lines.push(axisCircle(4, 0, 1, r1, [0, 0, r2 * Math.cos(b), r2 * Math.sin(b)]));
  }
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count;
    lines.push(axisCircle(4, 2, 3, r2, [r1 * Math.cos(a), r1 * Math.sin(a), 0, 0]));
  }
  return lines;
}

const duocylinderDef: SdfShapeDef = {
  id: 'duocylinder',
  kind: 'sdf',
  category: 'curved',
  dims: (n) => n === 4,
  name: () => 'Duocylinder',
  params: [
    { key: 'r1', label: 'Radius (xy)', min: 0.1, max: 3, step: 0.01, default: 1.2 },
    { key: 'r2', label: 'Radius (zw)', min: 0.1, max: 3, step: 0.01, default: 1.2 },
  ],
  sdf: () => E.max(E.sub(E.len(x(0), x(1)), p('r1')), E.sub(E.len(x(2), x(3)), p('r2'))),
  boundingRadius: (_n, q) => Math.hypot(q.r1, q.r2),
  wireframe: (_n, q) => {
    const lines = torusGrid4(q.r1, q.r2, 12);
    for (let i = 0; i < 6; i++) {
      const a = (2 * Math.PI * i) / 6;
      for (let j = 0; j < 6; j++) {
        const b = (2 * Math.PI * j) / 6;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const cb = Math.cos(b);
        const sb = Math.sin(b);
        lines.push([
          [q.r1 * ca, q.r1 * sa, 0, 0],
          [q.r1 * ca, q.r1 * sa, q.r2 * cb, q.r2 * sb],
        ]);
        lines.push([
          [0, 0, q.r2 * cb, q.r2 * sb],
          [q.r1 * ca, q.r1 * sa, q.r2 * cb, q.r2 * sb],
        ]);
      }
    }
    return lines;
  },
  info: () => ({
    description:
      'A disk in the xy-plane times a disk in the zw-plane. Its boundary is two solid tori glued together along a torus-shaped ridge.',
    funFact: 'That ridge is a Clifford torus: a torus that is completely flat, with zero curvature everywhere, which is impossible in 3D.',
  }),
};

const spherinderDef: SdfShapeDef = {
  id: 'spherinder',
  kind: 'sdf',
  category: 'curved',
  dims: (n) => n === 4,
  name: () => 'Spherinder',
  params: [
    { key: 'r', label: 'Sphere radius', min: 0.1, max: 3, step: 0.01, default: 1.3 },
    { key: 'h', label: 'Half-length (w)', min: 0.05, max: 3, step: 0.01, default: 1 },
  ],
  sdf: () => E.max(E.sub(E.len(x(0), x(1), x(2)), p('r')), E.sub(E.abs(x(3)), p('h'))),
  boundingRadius: (_n, q) => Math.hypot(q.r, q.h),
  wireframe: (_n, q) => {
    const lines: Vec[][] = [];
    for (const w of [-q.h, q.h])
      for (const [a, b] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ])
        lines.push(axisCircle(4, a, b, q.r, [0, 0, 0, w]));
    for (const d of sphereDirections(14)) {
      lines.push([
        [d[0] * q.r, d[1] * q.r, d[2] * q.r, -q.h],
        [d[0] * q.r, d[1] * q.r, d[2] * q.r, q.h],
      ]);
    }
    return lines;
  },
  info: () => ({
    description: 'A ball extruded along the w-axis: the 4D version of a cylinder, with two spherical caps and a curved side.',
    funFact: 'Unrotated, its slices are identical balls that suddenly vanish past w = ±h. Rotate it in xw and the slices become stretched capsules.',
  }),
};

const cubinderDef: SdfShapeDef = {
  id: 'cubinder',
  kind: 'sdf',
  category: 'curved',
  dims: (n) => n === 4,
  name: () => 'Cubinder',
  params: [
    { key: 'r', label: 'Disk radius (xy)', min: 0.1, max: 3, step: 0.01, default: 1.2 },
    { key: 'h', label: 'Half-side (z, w)', min: 0.05, max: 3, step: 0.01, default: 0.9 },
  ],
  sdf: () => E.max(E.sub(E.len(x(0), x(1)), p('r')), E.sub(E.abs(x(2)), p('h')), E.sub(E.abs(x(3)), p('h'))),
  boundingRadius: (_n, q) => Math.sqrt(q.r * q.r + 2 * q.h * q.h),
  wireframe: (_n, q) => {
    const lines: Vec[][] = [];
    for (const z of [-q.h, q.h]) for (const w of [-q.h, q.h]) lines.push(axisCircle(4, 0, 1, q.r, [0, 0, z, w]));
    for (let i = 0; i < 8; i++) {
      const a = (2 * Math.PI * i) / 8;
      const cx = q.r * Math.cos(a);
      const cy = q.r * Math.sin(a);
      const h = q.h;
      const corners = [
        [cx, cy, -h, -h],
        [cx, cy, h, -h],
        [cx, cy, h, h],
        [cx, cy, -h, h],
        [cx, cy, -h, -h],
      ];
      lines.push(corners);
    }
    return lines;
  },
  info: () => ({
    description: 'A disk (in xy) times a square (in zw): equivalently, a cylinder extruded along w.',
    funFact: 'It sits halfway between the tesseract (square × square) and the duocylinder (disk × disk).',
  }),
};

const cliffordDef: SdfShapeDef = {
  id: 'clifford',
  kind: 'sdf',
  category: 'curved',
  dims: (n) => n === 4,
  name: () => 'Clifford torus',
  params: [
    { key: 'r1', label: 'Radius (xy)', min: 0.1, max: 3, step: 0.01, default: 1.1 },
    { key: 'r2', label: 'Radius (zw)', min: 0.1, max: 3, step: 0.01, default: 1.1 },
    { key: 't', label: 'Thickness', min: 0.02, max: 1.5, step: 0.01, default: 0.35 },
  ],
  sdf: () => E.sub(E.len(E.sub(E.len(x(0), x(1)), p('r1')), E.sub(E.len(x(2), x(3)), p('r2'))), p('t')),
  boundingRadius: (_n, q) => Math.hypot(q.r1, q.r2) + q.t,
  wireframe: (_n, q) => torusGrid4(q.r1, q.r2, 16),
  info: () => ({
    description:
      'All points within distance t of the flat torus |(x,y)| = r1, |(z,w)| = r2 (a thickened Clifford torus, sometimes called a "tiger").',
    funFact: 'Rotate it in xw and its slices morph from a pair of rings into a single twisted loop and back.',
  }),
};

const spheritorusDef: SdfShapeDef = {
  id: 'spheritorus',
  kind: 'sdf',
  category: 'curved',
  dims: (n) => n === 4,
  name: () => 'Spheritorus',
  params: [
    { key: 'R', label: 'Ring radius (xy)', min: 0.1, max: 3, step: 0.01, default: 1.2 },
    { key: 'r', label: 'Ball radius', min: 0.05, max: 2, step: 0.01, default: 0.5 },
  ],
  sdf: () => E.sub(E.len(E.sub(E.len(x(0), x(1)), p('R')), x(2), x(3)), p('r')),
  boundingRadius: (_n, q) => q.R + q.r,
  wireframe: (_n, q) => {
    const lines: Vec[][] = [];
    for (let i = 0; i < 12; i++) {
      const a = (2 * Math.PI * i) / 12;
      const u = [Math.cos(a), Math.sin(a), 0, 0];
      const c = scale(u, q.R);
      lines.push(circle(c, u, basis(4, 2), q.r, 24), circle(c, u, basis(4, 3), q.r, 24), circle(c, basis(4, 2), basis(4, 3), q.r, 24));
    }
    for (const [dr, z, w] of [
      [q.r, 0, 0],
      [-q.r, 0, 0],
      [0, q.r, 0],
      [0, -q.r, 0],
      [0, 0, q.r],
      [0, 0, -q.r],
    ])
      lines.push(axisCircle(4, 0, 1, q.R + dr, [0, 0, z, w]));
    return lines;
  },
  info: () => ({
    description: 'A ball swept around a circle in the xy-plane: a donut whose cross-section is a solid ball instead of a disk.',
    funFact: 'At w = 0 its slice is an ordinary torus. Move the slice along w and the torus thins out until it vanishes.',
  }),
};

const torisphereDef: SdfShapeDef = {
  id: 'torisphere',
  kind: 'sdf',
  category: 'curved',
  dims: (n) => n === 4,
  name: () => 'Torisphere',
  params: [
    { key: 'R', label: 'Sphere radius (xyz)', min: 0.1, max: 3, step: 0.01, default: 1.2 },
    { key: 'r', label: 'Disk radius', min: 0.05, max: 2, step: 0.01, default: 0.45 },
  ],
  sdf: () => E.sub(E.len(E.sub(E.len(x(0), x(1), x(2)), p('R')), x(3)), p('r')),
  boundingRadius: (_n, q) => q.R + q.r,
  wireframe: (_n, q) => {
    const lines: Vec[][] = [];
    for (const d of sphereDirections(16)) {
      const u = [d[0], d[1], d[2], 0];
      lines.push(circle(scale(u, q.R), u, basis(4, 3), q.r, 24));
    }
    for (const [rr, w] of [
      [q.R + q.r, 0],
      [q.R - q.r, 0],
      [q.R, q.r],
      [q.R, -q.r],
    ])
      for (const [a, b] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ])
        lines.push(axisCircle(4, a, b, rr, [0, 0, 0, w]));
    return lines;
  },
  info: () => ({
    description: 'A disk swept over a sphere: every point within distance r of a 2-sphere of radius R sitting in the w = 0 space.',
    funFact: 'Its slice at w = 0 is a hollow ball (a thick spherical shell). Slide the slice along w and the shell gets thinner.',
  }),
};

const ditorusDef: SdfShapeDef = {
  id: 'ditorus',
  kind: 'sdf',
  category: 'curved',
  dims: (n) => n === 4,
  name: () => 'Ditorus',
  params: [
    { key: 'R1', label: 'Major radius', min: 0.2, max: 3, step: 0.01, default: 1.2 },
    { key: 'R2', label: 'Middle radius', min: 0.05, max: 2, step: 0.01, default: 0.5 },
    { key: 'r', label: 'Minor radius', min: 0.02, max: 1, step: 0.01, default: 0.2 },
  ],
  sdf: () => E.sub(E.len(E.sub(E.len(E.sub(E.len(x(0), x(1)), p('R1')), x(2)), p('R2')), x(3)), p('r')),
  boundingRadius: (_n, q) => q.R1 + q.R2 + q.r,
  wireframe: (_n, q) => {
    const lines: Vec[][] = [];
    for (const g of [0, 0.25, 0.5, 0.75]) {
      const gamma = 2 * Math.PI * g;
      lines.push(
        ...parametricGrid(
          (u, v) => {
            const a = 2 * Math.PI * u;
            const b = 2 * Math.PI * v;
            const radial = [Math.cos(a), Math.sin(a), 0, 0];
            const tubeN = addScaled(scale(radial, Math.cos(b)), basis(4, 2), Math.sin(b));
            const onTorus = addScaled(scale(radial, q.R1), tubeN, q.R2);
            return addScaled(addScaled(onTorus, tubeN, q.r * Math.cos(gamma)), basis(4, 3), q.r * Math.sin(gamma));
          },
          8,
          6,
          32,
        ),
      );
    }
    return lines;
  },
  info: () => ({
    description: 'Everything within distance r of an ordinary torus surface sitting in the w = 0 space: a torus, thickened into 4D.',
    funFact: 'At w = 0 its slice is a hollow torus (a torus-shaped shell). Away from w = 0 the shell splits into two nested tori.',
  }),
};

const hyperconeDef: SdfShapeDef = {
  id: 'hypercone',
  kind: 'sdf',
  category: 'curved',
  dims: (n) => n === 4,
  name: () => 'Hypercone',
  params: [
    { key: 'r', label: 'Base radius', min: 0.1, max: 3, step: 0.01, default: 1.4 },
    { key: 'h', label: 'Half-height (w)', min: 0.1, max: 3, step: 0.01, default: 1.2 },
  ],
  derive: (q) => coneDerived(q.r, q.h),
  // Apex at w = +h, ball of radius r at w = -h.
  sdf: () =>
    E.max(
      E.sub(E.add(E.mul(E.len(x(0), x(1), x(2)), p('c')), E.mul(x(3), p('kc'))), p('khc')),
      E.sub(E.abs(x(3)), p('h')),
    ),
  boundingRadius: (_n, q) => Math.hypot(q.r, q.h),
  wireframe: (_n, q) => {
    const lines: Vec[][] = [];
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      lines.push(axisCircle(4, a, b, q.r, [0, 0, 0, -q.h]));
    for (const d of sphereDirections(16)) {
      lines.push([
        [0, 0, 0, q.h],
        [d[0] * q.r, d[1] * q.r, d[2] * q.r, -q.h],
      ]);
    }
    return lines;
  },
  info: () => ({
    description: 'A cone in 4D whose cross-sections are balls, shrinking from radius r at w = -h to a point at w = +h.',
    funFact:
      'Tilt it into w and its slices become ellipsoids, paraboloids and hyperboloids: the 3D versions of the conic sections.',
  }),
};

function coneDerived(r: number, h: number): Record<string, number> {
  const k = r / (2 * h);
  const c = 1 / Math.sqrt(1 + k * k);
  return { c, kc: k * c, khc: k * h * c };
}

// --- surfaces

function kleinPoint(u: number, v: number, q: Record<string, number>): Vec {
  // A Klein bottle embedded in R⁴ without self-intersection: a torus whose tube
  // turns half a revolution in the zw-plane as it goes around.
  const ring = q.R + q.r * Math.cos(v);
  return [ring * Math.cos(u), ring * Math.sin(u), q.r * Math.sin(v) * Math.cos(u / 2), q.r * Math.sin(v) * Math.sin(u / 2)];
}

const kleinDef: SurfaceShapeDef = {
  id: 'klein',
  kind: 'surface',
  category: 'curved',
  dims: (n) => n === 4,
  name: () => 'Klein bottle',
  params: [
    { key: 'R', label: 'Ring radius', min: 0.3, max: 3, step: 0.01, default: 1.3 },
    { key: 'r', label: 'Tube radius', min: 0.1, max: 1.5, step: 0.01, default: 0.6 },
    { key: 't', label: 'Thickness', min: 0.02, max: 0.3, step: 0.005, default: 0.07 },
  ],
  point: kleinPoint,
  grid: [200, 100],
  boundingRadius: (_n, q) => Math.hypot(q.R + q.r, q.r) + q.t,
  wireframe: (_n, q) => parametricGrid((u, v) => kleinPoint(2 * Math.PI * u, 2 * Math.PI * v, q), 24, 10, 64),
  info: () => ({
    description:
      'A closed surface with no inside or outside. In 3D a Klein bottle has to pass through itself; in 4D it does not. Here it is thickened slightly, so its slice is a thin tube around the curve where the bottle crosses our world.',
    funFact: 'Cut a Klein bottle down the middle and it falls apart into two Möbius strips. Rotate it into w and watch the slice curve split and rejoin.',
  }),
};

// --- Flatland (3D) curved shapes

const torus3Def: SdfShapeDef = {
  id: 'torus',
  kind: 'sdf',
  category: 'flatland',
  dims: (n) => n === 3,
  name: () => 'Torus',
  params: [
    { key: 'R', label: 'Ring radius', min: 0.1, max: 3, step: 0.01, default: 1.2 },
    { key: 'r', label: 'Tube radius', min: 0.05, max: 2, step: 0.01, default: 0.5 },
  ],
  // Lying in the xz-plane (axis along y), so Flatland's z-slices cut across the ring.
  sdf: () => E.sub(E.len(E.sub(E.len(x(0), x(2)), p('R')), x(1)), p('r')),
  boundingRadius: (_n, q) => q.R + q.r,
  wireframe: (_n, q) =>
    parametricGrid(
      (u, v) => {
        const a = 2 * Math.PI * u;
        const b = 2 * Math.PI * v;
        const rr = q.R + q.r * Math.cos(b);
        return [rr * Math.cos(a), q.r * Math.sin(b), rr * Math.sin(a)];
      },
      16,
      8,
      40,
    ),
  info: () => ({
    description: 'A donut: every point within distance r of a circle of radius R.',
    funFact: 'Its flat slices can be one oval, a peanut, or two separate blobs, and at just the right tilt, two perfectly round interlocking Villarceau circles.',
  }),
};

const cylinder3Def: SdfShapeDef = {
  id: 'cylinder',
  kind: 'sdf',
  category: 'flatland',
  dims: (n) => n === 3,
  name: () => 'Cylinder',
  params: [
    { key: 'r', label: 'Radius', min: 0.1, max: 3, step: 0.01, default: 1.1 },
    { key: 'h', label: 'Half-height', min: 0.05, max: 3, step: 0.01, default: 1.2 },
  ],
  sdf: () => E.max(E.sub(E.len(x(0), x(2)), p('r')), E.sub(E.abs(x(1)), p('h'))),
  boundingRadius: (_n, q) => Math.hypot(q.r, q.h),
  wireframe: (_n, q) => {
    const lines: Vec[][] = [axisCircle(3, 0, 2, q.r, [0, q.h, 0]), axisCircle(3, 0, 2, q.r, [0, -q.h, 0])];
    for (let i = 0; i < 12; i++) {
      const a = (2 * Math.PI * i) / 12;
      lines.push([
        [q.r * Math.cos(a), -q.h, q.r * Math.sin(a)],
        [q.r * Math.cos(a), q.h, q.r * Math.sin(a)],
      ]);
    }
    return lines;
  },
  info: () => ({
    description: 'A disk extruded along the y-axis.',
    funFact: 'A Flatlander watching it pass by sees a rectangle that appears suddenly, widens, narrows and vanishes.',
  }),
};

const cone3Def: SdfShapeDef = {
  id: 'cone',
  kind: 'sdf',
  category: 'flatland',
  dims: (n) => n === 3,
  name: () => 'Cone',
  params: [
    { key: 'r', label: 'Base radius', min: 0.1, max: 3, step: 0.01, default: 1.2 },
    { key: 'h', label: 'Half-height', min: 0.1, max: 3, step: 0.01, default: 1.3 },
  ],
  derive: (q) => coneDerived(q.r, q.h),
  // Apex at y = +h, base disk at y = -h.
  sdf: () =>
    E.max(E.sub(E.add(E.mul(E.len(x(0), x(2)), p('c')), E.mul(x(1), p('kc'))), p('khc')), E.sub(E.abs(x(1)), p('h'))),
  boundingRadius: (_n, q) => Math.hypot(q.r, q.h),
  wireframe: (_n, q) => {
    const lines: Vec[][] = [axisCircle(3, 0, 2, q.r, [0, -q.h, 0])];
    for (let i = 0; i < 12; i++) {
      const a = (2 * Math.PI * i) / 12;
      lines.push([
        [0, q.h, 0],
        [q.r * Math.cos(a), -q.h, q.r * Math.sin(a)],
      ]);
    }
    return lines;
  },
  info: () => ({
    description: 'A circular cone with its apex pointing up the y-axis.',
    funFact: 'Its slices are the conic sections: circles, ellipses, parabolas and hyperbolas, depending on the tilt. Rotate it in yz to see them.',
  }),
};

// ---------------------------------------------------------------- registry

export const SHAPES: ShapeDef[] = [
  hypercubeDef,
  simplexDef,
  crossDef,
  cell24Def,
  cell600Def,
  cell120Def,
  ballDef,
  duocylinderDef,
  spherinderDef,
  cubinderDef,
  cliffordDef,
  spheritorusDef,
  torisphereDef,
  ditorusDef,
  hyperconeDef,
  kleinDef,
  duoprismDef,
  prismDef,
  ...platonic3D,
  torus3Def,
  cylinder3Def,
  cone3Def,
];

const byId = new Map(SHAPES.map((s) => [s.id, s]));

export function getShape(id: string): ShapeDef {
  const s = byId.get(id);
  if (!s) throw new Error(`Unknown shape "${id}"`);
  return s;
}

export function hasShape(id: string): boolean {
  return byId.has(id);
}

export function shapesForDim(n: number): ShapeDef[] {
  return SHAPES.filter((s) => s.dims(n));
}

export function defaultParams(def: ShapeDef): Record<string, number> {
  return Object.fromEntries(def.params.map((q) => [q.key, q.default]));
}

export function defaultOptions(def: ShapeDef): Record<string, number> {
  return Object.fromEntries((def.options ?? []).map((o) => [o.key, o.default]));
}

/** Parameters + derived values passed to an SDF expression. */
export function sdfValues(def: SdfShapeDef, params: Record<string, number>): Record<string, number> {
  return def.derive ? { ...params, ...def.derive(params) } : params;
}

export function sdfExpr(def: SdfShapeDef, n: number, options: Record<string, number>): Expr {
  return def.sdf(n, options);
}

/** Scaled polytope geometry for a size parameter. */
export function scaledFacets(g: PolytopeGeometry, size: number) {
  return g.facets.map((f) => ({ normal: f.normal, offset: f.offset * size }));
}

