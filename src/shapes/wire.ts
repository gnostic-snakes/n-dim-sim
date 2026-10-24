/** Helpers for building n-D wireframe polylines (used by the ghost view for curved shapes). */
import { addScaled, basis, normalize, zeros, type Vec } from '../math/vec';

/** Circle centred at c in the plane spanned by orthonormal u, v. Closed polyline. */
export function circle(c: Vec, u: Vec, v: Vec, r: number, segments = 48): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    out.push(addScaled(addScaled(c, u, r * Math.cos(a)), v, r * Math.sin(a)));
  }
  return out;
}

export function segment(a: Vec, b: Vec): Vec[] {
  return [a, b];
}

export function axisCircle(n: number, a: number, b: number, r: number, center?: Vec, segments = 48): Vec[] {
  return circle(center ?? zeros(n), basis(n, a), basis(n, b), r, segments);
}

/** Points spread fairly evenly on the unit 2-sphere (Fibonacci lattice). */
export function sphereDirections(count: number): Vec[] {
  const out: Vec[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const t = golden * i;
    out.push(normalize([r * Math.cos(t), y, r * Math.sin(t)]));
  }
  return out;
}

/** Map a parametric surface (u, v) in [0,1]^2 to a grid of polylines. */
export function parametricGrid(f: (u: number, v: number) => Vec, uLines: number, vLines: number, samples = 48): Vec[][] {
  const lines: Vec[][] = [];
  for (let i = 0; i < uLines; i++) {
    const u = i / uLines;
    const line: Vec[] = [];
    for (let s = 0; s <= samples; s++) line.push(f(u, s / samples));
    lines.push(line);
  }
  for (let j = 0; j < vLines; j++) {
    const v = j / vLines;
    const line: Vec[] = [];
    for (let s = 0; s <= samples; s++) line.push(f(s / samples, v));
    lines.push(line);
  }
  return lines;
}

/** Embed a lower-dimensional point into n-D by zero-padding. */
export function pad(p: Vec, n: number): Vec {
  const out = zeros(n);
  for (let i = 0; i < Math.min(n, p.length); i++) out[i] = p[i];
  return out;
}
