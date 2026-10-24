import type { Vec } from './vec';

/**
 * 2D convex hull (Andrew's monotone chain). Returns indices of hull vertices in
 * counter-clockwise order, without collinear points. Null if degenerate.
 */
export function convexHull2(points: Vec[], eps = 1e-12): number[] | null {
  const idx = points.map((_, i) => i);
  idx.sort((a, b) => points[a][0] - points[b][0] || points[a][1] - points[b][1]);
  const cross = (o: number, a: number, b: number) =>
    (points[a][0] - points[o][0]) * (points[b][1] - points[o][1]) -
    (points[a][1] - points[o][1]) * (points[b][0] - points[o][0]);
  let scale = 0;
  for (const p of points) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]));
  const tol = eps * Math.max(scale * scale, 1e-300);

  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= tol) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= tol) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : null;
}
