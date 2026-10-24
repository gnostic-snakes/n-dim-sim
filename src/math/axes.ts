/**
 * Axis naming and rotation-plane bookkeeping for n dimensions.
 *
 * Axes are x, y, z, w, then v, u, t, s for dimensions 5+. The visible world is
 * spanned by the first `sliceDim(n)` axes (x, y, z for n >= 4; x, y in Flatland).
 */
export const AXIS_NAMES = ['x', 'y', 'z', 'w', 'v', 'u', 't', 's'] as const;

export const MIN_DIM = 3;
export const MAX_DIM = 8;

export type Plane = [number, number];

export function axisName(i: number): string {
  return AXIS_NAMES[i] ?? `a${i}`;
}

/** Index of an axis name ("x" -> 0, "w" -> 3). Returns -1 if unknown. */
export function axisIndex(name: string): number {
  return (AXIS_NAMES as readonly string[]).indexOf(name);
}

/**
 * Dimension of the visible slice. In 4D+ we see a 3D slice; in Flatland mode
 * (n = 3) we see a 2D slice.
 */
export function sliceDim(n: number): number {
  return n >= 4 ? 3 : n - 1;
}

/** Number of hidden axes (each one gets its own slice offset). */
export function hiddenCount(n: number): number {
  return n - sliceDim(n);
}

export function isHiddenAxis(n: number, axis: number): boolean {
  return axis >= sliceDim(n);
}

/** All n(n-1)/2 rotation planes, in lexicographic order (xy, xz, xw, yz, yw, zw for 4D). */
export function rotationPlanes(n: number): Plane[] {
  const out: Plane[] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) out.push([a, b]);
  return out;
}

export function planeName(p: Plane): string {
  return axisName(p[0]) + axisName(p[1]);
}

/** Parse "xw" -> [0, 3] (order normalized so a < b). */
export function parsePlane(s: string): Plane {
  const a = axisIndex(s[0]);
  const b = axisIndex(s[1]);
  if (a < 0 || b < 0 || a === b) throw new Error(`Invalid plane "${s}"`);
  return a < b ? [a, b] : [b, a];
}

/**
 * How a rotation in this plane affects what we see:
 *  - 'visible': both axes visible, the slice just spins like a normal 3D object.
 *  - 'mixing': one visible + one hidden axis, the slice morphs.
 *  - 'hidden': both axes hidden, the slice only changes if the slice offsets are non-zero.
 */
export type PlaneKind = 'visible' | 'mixing' | 'hidden';

export function planeKind(n: number, p: Plane): PlaneKind {
  const ha = isHiddenAxis(n, p[0]);
  const hb = isHiddenAxis(n, p[1]);
  if (!ha && !hb) return 'visible';
  if (ha && hb) return 'hidden';
  return 'mixing';
}

/** Two planes share an axis iff rotations in them (generally) fail to commute. */
export function planesShareAxis(p: Plane, q: Plane): boolean {
  return p[0] === q[0] || p[0] === q[1] || p[1] === q[0] || p[1] === q[1];
}
