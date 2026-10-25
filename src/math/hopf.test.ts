import { describe, expect, it } from 'vitest';
import { identity } from './mat';
import { rotation } from './homogeneous';
import { circlePoints, fiberPoint, hopfMap, linkingNumber, projectedFiber, stereographic } from './hopf';
import { dist, norm } from './vec';

describe('Hopf fibration', () => {
  it('fibers lie on the 3-sphere and map to their base point', () => {
    for (const [theta, phi] of [
      [0.3, 1.1],
      [Math.PI / 2, -2],
      [2.8, 0.4],
    ]) {
      const base = [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
      for (let t = 0; t < 6.28; t += 0.7) {
        const p = fiberPoint(theta, phi, t);
        expect(norm(p)).toBeCloseTo(1, 12);
        const h = hopfMap(p);
        for (let i = 0; i < 3; i++) expect(h[i]).toBeCloseTo(base[i], 12);
      }
    }
  });

  it('projects fibers to circles', () => {
    const rot = rotation(4, 0, 3, 0.4);
    const c = projectedFiber(1.2, 0.5, rot)!;
    expect(c).not.toBeNull();
    // Every projected fiber point is on the computed circle.
    for (let t = 0; t < 6.28; t += 0.3) {
      const p = stereographic(rot.slice(0, 4).map((row) => row.slice(0, 4).reduce((s, v, j) => s + v * fiberPoint(1.2, 0.5, t)[j], 0)));
      expect(Math.abs(dist(p, c.center) - c.radius)).toBeLessThan(1e-9);
      const off = [0, 1, 2].reduce((s, k) => s + (p[k] - c.center[k]) * c.normal[k], 0);
      expect(Math.abs(off)).toBeLessThan(1e-9);
    }
  });

  it('links every pair of fibers exactly once', () => {
    const I = identity(5);
    const pairs = [
      [
        [0.7, 0.2],
        [2.1, 2.5],
      ],
      [
        [1.4, 0],
        [1.4, 1.5],
      ],
      [
        [0.4, 3],
        [0.5, 0.1],
      ],
    ];
    for (const [[t1, p1], [t2, p2]] of pairs) {
      const a = circlePoints(projectedFiber(t1, p1, I)!, 160);
      const b = circlePoints(projectedFiber(t2, p2, I)!, 160);
      expect(Math.abs(linkingNumber(a, b))).toBeCloseTo(1, 2);
    }
  });
});
