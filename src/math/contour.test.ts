import { describe, expect, it } from 'vitest';
import { countComponents, marchingSquares } from './contour';

function grid(f: (u: number, v: number) => number, u0: number, v0: number, du: number, dv: number, nu: number, nv: number) {
  return Array.from({ length: nu + 1 }, (_, i) => Float64Array.from({ length: nv + 1 }, (_, j) => f(u0 + i * du, v0 + j * dv)));
}

describe('marching squares', () => {
  it('traces a circle as one closed loop', () => {
    const n = 80;
    const d = 4 / n;
    const segs = marchingSquares(grid((u, v) => u * u + v * v - 1, -2, -2, d, d, n, n), -2, -2, d, d);
    expect(segs.length).toBeGreaterThan(40);
    for (const s of segs) for (const p of [s.a, s.b]) expect(Math.abs(Math.hypot(p[0], p[1]) - 1)).toBeLessThan(0.01);
    expect(countComponents(segs, 1e-9)).toBe(1);
  });

  it('separates two loops and resolves saddles consistently', () => {
    const n = 90;
    const d = 6 / n;
    // Two blobs that nearly touch: two separate loops.
    const f = (u: number, v: number) => Math.min((u - 1.2) ** 2 + v * v, (u + 1.2) ** 2 + v * v) - 1.0137;
    const segs = marchingSquares(grid(f, -3, -3, d, d, n, n), -3, -3, d, d);
    expect(countComponents(segs, 1e-9)).toBe(2);
    // Every endpoint is shared by exactly two segments (closed curves, no dangling ends).
    const deg = new Map<string, number>();
    for (const s of segs)
      for (const p of [s.a, s.b]) {
        const k = p.map((x) => Math.round(x * 1e9)).join(',');
        deg.set(k, (deg.get(k) ?? 0) + 1);
      }
    for (const v of deg.values()) expect(v).toBe(2);
  });
});
