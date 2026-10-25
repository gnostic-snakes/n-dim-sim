/**
 * Ready-made scenes that show off the classics: spins, scans, double
 * rotations, and the Flatland warm-ups.
 */
import { hiddenCount, parsePlane } from '../math/axes';
import { defaultOptions, defaultParams, getShape } from '../shapes/registry';
import {
  defaultView,
  OBJECT_COLORS,
  paths,
  UNIFORM,
  type CameraState,
  type Easing,
  type Keyframe,
  type Scene,
  type SceneObject,
  type TransformOp,
  type ViewSettings,
} from './model';

export interface Preset {
  id: string;
  title: string;
  description: string;
  group: 'Classics' | 'Polytopes' | 'Curved' | 'Flatland' | 'Higher dimensions';
  build: () => Scene;
}

// ---------------------------------------------------------------- tiny builder

const rot = (plane: string, value: number, id = `r_${plane}`): TransformOp => ({
  id,
  kind: 'rotate',
  enabled: true,
  plane: parsePlane(plane),
  axis: 0,
  value,
});
const move = (axis: number, value: number, id = `t${axis}`): TransformOp => ({
  id,
  kind: 'translate',
  enabled: true,
  plane: [0, 1],
  axis,
  value,
});
const scl = (axis: number | 'all', value: number, id = `s${axis}`): TransformOp => ({
  id,
  kind: 'scale',
  enabled: true,
  plane: [0, 1],
  axis: axis === 'all' ? UNIFORM : axis,
  value,
});

function obj(id: string, shape: string, dim: number, init: Partial<SceneObject> = {}): SceneObject {
  const def = getShape(shape);
  if (!def.dims(dim)) throw new Error(`${shape} is not ${dim}D`);
  return {
    id,
    shape,
    params: { ...defaultParams(def), ...(init.params ?? {}) },
    options: { ...defaultOptions(def), ...(init.options ?? {}) },
    ops: init.ops ?? [],
    color: init.color ?? OBJECT_COLORS[0],
    visible: true,
    label: init.label,
  };
}

let keyCounter = 0;
const k = (t: number, v: number, ease: Easing = 'linear'): Keyframe => ({ id: `k${keyCounter++}`, t, v, ease });

function scene(
  dim: number,
  objects: SceneObject[],
  opts: {
    title: string;
    slice?: number[];
    tracks?: Record<string, Keyframe[]>;
    duration?: number;
    loop?: boolean;
    view?: Partial<ViewSettings>;
    camera?: Partial<CameraState>;
  },
): Scene {
  const slice = new Array(hiddenCount(dim)).fill(0).map((_, i) => opts.slice?.[i] ?? 0);
  const view = { ...defaultView(), ...(opts.view ?? {}) };
  return {
    version: 1,
    title: opts.title,
    dim,
    slice,
    objects,
    view,
    timeline: { duration: opts.duration ?? 8, loop: opts.loop ?? true, tracks: opts.tracks ?? {} },
    camera: { yaw: 0.65, pitch: 0.38, distance: 8.5, target: [0, 0, 0], ...(opts.camera ?? {}) },
  };
}

/** Rotation angles that turn the long diagonal (1,1,...,1) of an n-cube onto the last axis. */
function diagonalOps(n: number): TransformOp[] {
  const ops: TransformOp[] = [];
  // Fold each coordinate into the last axis with a Givens rotation, from the second-to-last down.
  let acc = 1; // length of the part already folded into the last axis
  for (let i = n - 2; i >= 0; i--) {
    const theta = (Math.atan2(1, acc) * 180) / Math.PI;
    acc = Math.hypot(1, acc);
    const names = 'xyzwvuts';
    ops.push(rot(`${names[i]}${names[n - 1]}`, theta, `diag${i}`));
  }
  return ops;
}

// ---------------------------------------------------------------- presets

export const PRESETS: Preset[] = [
  {
    id: 'tesseract-spin',
    group: 'Classics',
    title: 'Tesseract: xw spin',
    description:
      'A tesseract turning in the xw-plane. The cube you see stretches, grows new faces and returns to a cube every quarter turn.',
    build: () =>
      scene(4, [obj('a', 'hypercube', 4, { ops: [rot('xw', 0)] })], {
        title: 'Tesseract: xw spin',
        duration: 12,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0), k(12, 360)] },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'tesseract-diagonal',
    group: 'Classics',
    title: 'Tesseract: diagonal scan',
    description:
      'The tesseract is turned so its long diagonal points along w, then the slice sweeps through it: tetrahedron, truncated tetrahedron, octahedron at the center, and back.',
    build: () =>
      scene(4, [obj('a', 'hypercube', 4, { ops: diagonalOps(4) })], {
        title: 'Tesseract: diagonal scan',
        slice: [-2],
        duration: 10,
        tracks: { [paths.slice(0)]: [k(0, -2.02, 'ease'), k(5, 2.02, 'ease'), k(10, -2.02)] },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'double-rotation',
    group: 'Classics',
    title: 'Double rotation (xy + zw)',
    description:
      'Two rotations at the same speed in completely perpendicular planes: an isoclinic double rotation. No line stays fixed, something impossible in 3D.',
    build: () =>
      scene(4, [obj('a', 'hypercube', 4, { ops: [rot('xw', 25, 'tilt1'), rot('yz', 20, 'tilt2'), rot('xy', 0), rot('zw', 0)] })], {
        title: 'Double rotation (xy + zw)',
        duration: 12,
        tracks: {
          [paths.op('a', 'r_xy')]: [k(0, 0), k(12, 360)],
          [paths.op('a', 'r_zw')]: [k(0, 0), k(12, 360)],
        },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'cell24-scan',
    group: 'Classics',
    title: 'Scan through the 24-cell',
    description: 'The slice sweeps through the 24-cell along w: octahedra near the ends, a cuboctahedron at the middle.',
    build: () =>
      scene(4, [obj('a', 'cell24', 4, { ops: [rot('xw', 0)] })], {
        title: 'Scan through the 24-cell',
        slice: [-1.45],
        duration: 10,
        tracks: { [paths.slice(0)]: [k(0, -1.45, 'ease'), k(5, 1.45, 'ease'), k(10, -1.45)] },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'hypersphere',
    group: 'Classics',
    title: 'A hypersphere passes by',
    description:
      'A 4D ball moving through our 3D world: a point appears, swells into a sphere and shrinks away, exactly like a sphere visiting Flatland.',
    build: () =>
      scene(4, [obj('a', 'ball', 4, { params: { r: 1.6 }, ops: [move(3, 0, 'tw')] })], {
        title: 'A hypersphere passes by',
        duration: 8,
        tracks: { [paths.op('a', 'tw')]: [k(0, -1.75, 'ease'), k(4, 1.75, 'ease'), k(8, -1.75)] },
        view: { shading: 'depth', edges: false },
      }),
  },
  {
    id: 'cell600',
    group: 'Polytopes',
    title: '600-cell turning',
    description: 'Six hundred tetrahedral cells, coloured individually, sliced while the 600-cell turns slowly in xw and yz.',
    build: () =>
      scene(4, [obj('a', 'cell600', 4, { ops: [rot('xw', 0), rot('yz', 0)] })], {
        title: '600-cell turning',
        duration: 24,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0), k(24, 360)], [paths.op('a', 'r_yz')]: [k(0, 0), k(24, 120)] },
        view: { shading: 'cells' },
        camera: { distance: 7.5 },
      }),
  },
  {
    id: 'cell120',
    group: 'Polytopes',
    title: '120-cell scan',
    description: 'Scanning through the 120-cell: slices are built from cuts through its 120 dodecahedral cells.',
    build: () =>
      scene(4, [obj('a', 'cell120', 4, { ops: [rot('xw', 12), rot('yz', 18)] })], {
        title: '120-cell scan',
        slice: [-2],
        duration: 14,
        tracks: { [paths.slice(0)]: [k(0, -2.15, 'ease'), k(7, 2.15, 'ease'), k(14, -2.15)] },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'cell5',
    group: 'Polytopes',
    title: '5-cell tumble',
    description: 'The simplest 4D polytope. Its slices flip between tetrahedra and triangular prisms as it tumbles through w.',
    build: () =>
      scene(4, [obj('a', 'simplex', 4, { ops: [rot('xw', 0), rot('yw', 0)] })], {
        title: '5-cell tumble',
        duration: 12,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0), k(12, 360)], [paths.op('a', 'r_yw')]: [k(0, 0), k(12, 180)] },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'cell16',
    group: 'Polytopes',
    title: '16-cell spin',
    description: 'The 16-cell (the tesseract’s dual) turning in the yw-plane. At w = 0 it starts as an octahedron.',
    build: () =>
      scene(4, [obj('a', 'cross', 4, { ops: [rot('yw', 0), rot('xz', 20, 'tilt')] })], {
        title: '16-cell spin',
        duration: 12,
        tracks: { [paths.op('a', 'r_yw')]: [k(0, 0), k(12, 360)] },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'duoprism',
    group: 'Polytopes',
    title: '3,8-duoprism',
    description: 'A triangle times an octagon. Rotating in xw mixes the two polygons, so prisms of both kinds take turns.',
    build: () =>
      scene(4, [obj('a', 'duoprism', 4, { options: { p: 3, q: 8 }, ops: [rot('xw', 0), rot('yz', 30, 'tilt')] })], {
        title: '3,8-duoprism',
        duration: 12,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0), k(12, 360)] },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'duocylinder',
    group: 'Curved',
    title: 'Duocylinder roll',
    description: 'A disk times a disk. Turning it in xw makes the slice roll between a cylinder and a lens shape.',
    build: () =>
      scene(4, [obj('a', 'duocylinder', 4, { ops: [rot('xw', 0)], color: OBJECT_COLORS[1] })], {
        title: 'Duocylinder roll',
        duration: 10,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0), k(10, 360)] },
        view: { shading: 'tilt' },
      }),
  },
  {
    id: 'clifford',
    group: 'Curved',
    title: 'Clifford torus: linked rings',
    description: 'A thickened flat torus. As it turns in xw its slice becomes two rings, which link and unlink.',
    build: () =>
      scene(4, [obj('a', 'clifford', 4, { ops: [rot('xw', 0)], color: OBJECT_COLORS[2] })], {
        title: 'Clifford torus: linked rings',
        duration: 12,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0), k(12, 360)] },
        view: { shading: 'tilt' },
      }),
  },
  {
    id: 'spheritorus',
    group: 'Curved',
    title: 'Spheritorus scan',
    description: 'A ball swept around a circle. Slicing it at different w gives tori of different thickness.',
    build: () =>
      scene(4, [obj('a', 'spheritorus', 4, { ops: [rot('yz', 25, 'tilt'), rot('zw', 0)], color: OBJECT_COLORS[3] })], {
        title: 'Spheritorus scan',
        duration: 10,
        tracks: { [paths.op('a', 'r_zw')]: [k(0, 0), k(10, 360)] },
        view: { shading: 'tilt' },
      }),
  },
  {
    id: 'hypercone',
    group: 'Curved',
    title: 'Hypercone: 3D conic sections',
    description:
      'Tilting a 4D cone through our world: slices go from spheres to ellipsoids, then a paraboloid, then a hyperboloid, the 3D versions of the conic sections.',
    build: () =>
      scene(4, [obj('a', 'hypercone', 4, { ops: [rot('xw', 0)], color: OBJECT_COLORS[4] })], {
        title: 'Hypercone: 3D conic sections',
        duration: 10,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0, 'ease'), k(5, 88, 'ease'), k(10, 0)] },
        view: { shading: 'depth', edges: false },
      }),
  },
  {
    id: 'ditorus',
    group: 'Curved',
    title: 'Ditorus',
    description: 'A torus thickened into 4D. At w = 0 the slice is a hollow torus; tilting it in w splits the shell.',
    build: () =>
      scene(4, [obj('a', 'ditorus', 4, { ops: [rot('yz', 30, 'tilt'), rot('xw', 0)], color: OBJECT_COLORS[5] })], {
        title: 'Ditorus',
        duration: 12,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0), k(12, 360)] },
        view: { shading: 'tilt' },
      }),
  },
  {
    id: 'klein',
    group: 'Curved',
    title: 'Klein bottle in 4D',
    description:
      'A Klein bottle needs a fourth dimension to avoid crossing itself. Its slice is a tube that splits into separate loops and joins up again as the bottle turns.',
    build: () =>
      scene(4, [obj('a', 'klein', 4, { ops: [rot('yz', 35, 'tilt'), rot('xw', 0)], color: OBJECT_COLORS[3] })], {
        title: 'Klein bottle in 4D',
        duration: 16,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0), k(16, 360)] },
        view: { shading: 'cells' },
        camera: { distance: 9.5, pitch: 0.3, target: [0, -0.2, 0] },
      }),
  },
  {
    id: 'flat-sphere',
    group: 'Flatland',
    title: 'A sphere visits Flatland',
    description:
      'The analogy everything else builds on: a 3D sphere passing through a 2D world appears as a circle that grows and shrinks.',
    build: () =>
      scene(3, [obj('a', 'ball', 3, { params: { r: 1.5 }, ops: [move(2, 0, 'tz')], color: OBJECT_COLORS[1] })], {
        title: 'A sphere visits Flatland',
        duration: 8,
        tracks: { [paths.op('a', 'tz')]: [k(0, -1.7, 'ease'), k(4, 1.7, 'ease'), k(8, -1.7)] },
        view: { shading: 'depth' },
      }),
  },
  {
    id: 'flat-cube',
    group: 'Flatland',
    title: 'Cube corner-first into Flatland',
    description:
      'A cube enters Flatland corner first: a point grows into a triangle, becomes a regular hexagon at the middle, then shrinks back.',
    build: () =>
      scene(3, [obj('a', 'hypercube', 3, { params: { size: 1.8 }, ops: diagonalOps(3) })], {
        title: 'Cube corner-first into Flatland',
        slice: [-1.8],
        duration: 10,
        tracks: { [paths.slice(0)]: [k(0, -1.82, 'ease'), k(5, 1.82, 'ease'), k(10, -1.82)] },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'flat-torus',
    group: 'Flatland',
    title: 'Torus slices and Villarceau circles',
    description: 'Tilting a torus through Flatland: two circles, then a pair of interlocking Villarceau circles, then a ring.',
    build: () =>
      scene(3, [obj('a', 'torus', 3, { ops: [rot('yz', 0)], color: OBJECT_COLORS[2] })], {
        title: 'Torus slices and Villarceau circles',
        duration: 10,
        tracks: { [paths.op('a', 'r_yz')]: [k(0, 0, 'ease'), k(5, 90, 'ease'), k(10, 0)] },
        view: { shading: 'tilt' },
      }),
  },
  {
    id: 'flat-cone',
    group: 'Flatland',
    title: 'Conic sections',
    description: 'Tilting a cone through Flatland draws the conic sections: circle, ellipse, parabola, hyperbola.',
    build: () =>
      scene(3, [obj('a', 'cone', 3, { ops: [rot('yz', 90)], color: OBJECT_COLORS[4] })], {
        title: 'Conic sections',
        duration: 10,
        tracks: { [paths.op('a', 'r_yz')]: [k(0, 90, 'ease'), k(5, 0, 'ease'), k(10, 90)] },
        view: { shading: 'depth' },
      }),
  },
  {
    id: 'penteract',
    group: 'Higher dimensions',
    title: 'Penteract (5-cube)',
    description: 'A 5D cube with two hidden axes, w and v. Rotations in xw and yv each pull in a different hidden direction.',
    build: () =>
      scene(5, [obj('a', 'hypercube', 5, { ops: [rot('zw', 30, 'tilt1'), rot('xv', 20, 'tilt2'), rot('xw', 0), rot('yv', 0)] })], {
        title: 'Penteract (5-cube)',
        duration: 16,
        tracks: { [paths.op('a', 'r_xw')]: [k(0, 0), k(16, 360)], [paths.op('a', 'r_yv')]: [k(0, 0), k(16, 180)] },
        view: { shading: 'cells' },
      }),
  },
  {
    id: 'hexacross',
    group: 'Higher dimensions',
    title: '6D cross-polytope scan',
    description: 'A 6D orthoplex turned so its slices change in two hidden directions at once while the w offset sweeps.',
    build: () =>
      scene(6, [obj('a', 'cross', 6, { ops: [rot('xw', 30, 'a1'), rot('yv', 40, 'a2'), rot('zu', 25, 'a3')] })], {
        title: '6D cross-polytope scan',
        duration: 10,
        tracks: { [paths.slice(0)]: [k(0, -0.9, 'ease'), k(5, 0.9, 'ease'), k(10, -0.9)] },
        view: { shading: 'tilt' },
      }),
  },
];

export function buildPreset(id: string): Scene | null {
  const p = PRESETS.find((x) => x.id === id);
  return p ? p.build() : null;
}

export { scl, move, rot, diagonalOps };
