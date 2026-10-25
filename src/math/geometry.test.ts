import { describe, expect, it } from 'vitest';
import { convexHull2 } from './hull2';
import { convexHull3 } from './hull3';
import { chebyshevCenter } from './lp';
import { compileJS, E, exprParams, glslHelpers, toGLSL } from './sdf';
import { cross3, dot, normalize, sub, type Vec } from './vec';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('chebyshevCenter', () => {
  it('finds the center of a box', () => {
    const normals = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const offsets = [3, -1, 2, 2, 5, 5]; // x in [1, 3], y in [-2, 2], z in [-5, 5]
    const r = chebyshevCenter(normals, offsets, 3)!;
    expect(r.radius).toBeCloseTo(1, 10);
    expect(r.center[0]).toBeCloseTo(2, 10);
    expect(Math.abs(r.center[1])).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('handles a 2D triangle', () => {
    // Equilateral triangle with inradius 1 around (5, -2).
    const normals: Vec[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (2 * Math.PI * i) / 3 + 0.3;
      const nrm = [Math.cos(a), Math.sin(a)];
      normals.push(nrm);
      offsets.push(1 + dot(nrm, [5, -2]));
    }
    const r = chebyshevCenter(normals, offsets, 2)!;
    expect(r.radius).toBeCloseTo(1, 9);
    expect(r.center[0]).toBeCloseTo(5, 9);
    expect(r.center[1]).toBeCloseTo(-2, 9);
  });

  it('reports empty regions with a non-positive radius', () => {
    const r = chebyshevCenter([[1], [-1]], [-1, -1], 1)!; // x <= -1 and x >= 1
    expect(r.radius).toBeLessThan(0);
  });

  it('returns null for unbounded regions', () => {
    expect(chebyshevCenter([[1, 0]], [1], 2)).toBeNull();
  });
});

describe('convex hulls', () => {
  it('2D hull drops interior and collinear points', () => {
    const pts = [
      [0, 0],
      [2, 0],
      [1, 0],
      [2, 2],
      [0, 2],
      [1, 1],
    ];
    const h = convexHull2(pts)!;
    expect(h).toHaveLength(4);
    expect(new Set(h)).toEqual(new Set([0, 1, 3, 4]));
  });

  const checkHull = (pts: Vec[]) => {
    const h = convexHull3(pts);
    expect(h).not.toBeNull();
    const faces = h!.faces;
    // Closed triangulated sphere: E = 3F/2 and V - E + F = 2.
    const v = h!.vertices.length;
    expect(v - (3 * faces.length) / 2 + faces.length).toBe(2);
    // Every point lies inside (or on) every face plane.
    let scale = 0;
    for (const p of pts) scale = Math.max(scale, Math.hypot(p[0], p[1], p[2]));
    for (const [a, b, c] of faces) {
      const n = normalize(cross3(sub(pts[b], pts[a]), sub(pts[c], pts[a])));
      const d = dot(n, pts[a]);
      for (const p of pts) expect(dot(n, p) - d).toBeLessThan(1e-8 * scale);
    }
    return h!;
  };

  it('hulls a cube (with coplanar points)', () => {
    const pts: Vec[] = [];
    for (let i = 0; i < 8; i++) pts.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
    pts.push([0, 0, 0], [1, 0, 0], [0, 1, 1]);
    const h = checkHull(pts);
    expect(h.vertices).toHaveLength(8);
    expect(h.faces).toHaveLength(12);
  });

  it('hulls random point clouds', () => {
    const rand = rng(7);
    for (let t = 0; t < 20; t++) {
      const pts: Vec[] = [];
      for (let i = 0; i < 200; i++) pts.push([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]);
      checkHull(pts);
    }
  });

  it('hulls points on a sphere', () => {
    const rand = rng(11);
    const pts: Vec[] = [];
    for (let i = 0; i < 500; i++) {
      const v = normalize([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]);
      pts.push(v);
    }
    const h = checkHull(pts);
    expect(h.vertices).toHaveLength(500);
  });

  it('returns null for flat input', () => {
    expect(
      convexHull3([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ]),
    ).toBeNull();
  });
});

describe('SDF expressions', () => {
  const duocyl = E.max(E.sub(E.len(E.x(0), E.x(1)), E.p('r1')), E.sub(E.len(E.x(2), E.x(3)), E.p('r2')));

  it('evaluates in JS', () => {
    const f = compileJS(duocyl);
    expect(f([0, 0, 0, 0], { r1: 1, r2: 2 })).toBeCloseTo(-1);
    expect(f([3, 4, 0, 0], { r1: 1, r2: 2 })).toBeCloseTo(4);
    expect(exprParams(duocyl)).toEqual(['r1', 'r2']);
  });

  it('generates GLSL', () => {
    const helpers = new Set<number>();
    const src = toGLSL(duocyl, { coord: (i) => `p[${i}]`, param: (n) => `u_${n}` }, helpers);
    expect(src).toBe('max((length(vec2(p[0], p[1])) - u_r1), (length(vec2(p[2], p[3])) - u_r2))');
    const big = toGLSL(E.len(...E.xs(0, 6)), { coord: (i) => `p${i}`, param: (n) => n }, helpers);
    expect(big).toBe('slen6(p0, p1, p2, p3, p4, p5)');
    expect(glslHelpers(helpers)).toContain('float slen6(float a0');
  });
});
