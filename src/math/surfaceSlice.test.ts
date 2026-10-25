import { describe, expect, it } from 'vitest';
import { getShape } from '../shapes/registry';
import type { SurfaceShapeDef } from '../shapes/types';
import { composeStack } from './transforms';
import { sliceSurface } from './surfaceSlice';
import { dist } from './vec';

const klein = getShape('klein') as SurfaceShapeDef;
const params = { R: 1.3, r: 0.6, t: 0.07 };

function slice(ops: Parameters<typeof composeStack>[1], s: number, grid: [number, number] = klein.grid) {
  const { matrix } = composeStack(4, ops);
  return sliceSurface({ point: (u, v) => klein.point(u, v, params), matrix, hidden: [s], k: 3, grid, tube: params.t, depthScale: 1 });
}

describe('surface slicing (Klein bottle)', () => {
  const ops = [
    { kind: 'rotate' as const, plane: [1, 2] as [number, number], angle: 35 },
    { kind: 'rotate' as const, plane: [0, 3] as [number, number], angle: 50 },
  ];

  it('finds closed curves that converge as the grid is refined', () => {
    const coarse = slice(ops, 0.12);
    const fine = slice(ops, 0.12, [800, 400]);
    expect(coarse.segments.length).toBeGreaterThan(50);
    expect(coarse.loops).toBe(fine.loops);
    // Every coarse point lies close to the fine curve.
    for (const sg of coarse.segments.filter((_, i) => i % 7 === 0)) {
      const d = Math.min(...fine.segments.map((f) => dist(f.a, sg.a)));
      expect(d).toBeLessThan(0.02);
    }
  });

  it('bounds every segment by its chunk sphere', () => {
    const s = slice(ops, -0.2);
    for (const ch of s.chunks)
      for (let i = ch.start; i < ch.start + ch.count; i++)
        for (const p of [s.segments[i].a, s.segments[i].b]) expect(dist(p, ch.center) + s.tube).toBeLessThanOrEqual(ch.radius + 1e-9);
    expect(s.chunks.reduce((n, c) => n + c.count, 0)).toBe(s.segments.length);
  });

  it('is empty when the slice misses the bottle', () => {
    expect(slice(ops, 2.5).segments).toHaveLength(0);
  });
});
