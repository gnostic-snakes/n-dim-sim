import { describe, expect, it } from 'vitest';
import { MAX_DIM, MIN_DIM, parsePlane, planeKind, planeName, rotationPlanes, sliceDim } from './axes';
import { singularValues, symmetricEigenvalues } from './eigen';
import { applyPoint, linearPart, rotation, scaling, translation } from './homogeneous';
import { determinant, identity, inverse, isOrthogonal, maxAbsDiff, multiply, solve, transpose } from './mat';
import { composeStack, stretchRange, type TransformOpSpec } from './transforms';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('axes', () => {
  it('enumerates n(n-1)/2 rotation planes', () => {
    for (let n = 2; n <= MAX_DIM; n++) expect(rotationPlanes(n)).toHaveLength((n * (n - 1)) / 2);
    expect(rotationPlanes(4).map(planeName)).toEqual(['xy', 'xz', 'xw', 'yz', 'yw', 'zw']);
  });

  it('parses plane names and classifies planes', () => {
    expect(parsePlane('xw')).toEqual([0, 3]);
    expect(parsePlane('wx')).toEqual([0, 3]);
    expect(planeKind(4, parsePlane('xy'))).toBe('visible');
    expect(planeKind(4, parsePlane('zw'))).toBe('mixing');
    expect(planeKind(5, parsePlane('wv'))).toBe('hidden');
    expect(sliceDim(3)).toBe(2);
    expect(sliceDim(4)).toBe(3);
    expect(sliceDim(8)).toBe(3);
  });
});

describe('rotation matrices', () => {
  it('are orthogonal with determinant 1, for every plane in every supported dimension', () => {
    const rand = rng(42);
    for (let n = MIN_DIM; n <= MAX_DIM; n++) {
      for (const [a, b] of rotationPlanes(n)) {
        const theta = (rand() * 2 - 1) * 4 * Math.PI;
        const r = linearPart(rotation(n, a, b, theta));
        expect(isOrthogonal(r, 1e-12)).toBe(true);
        expect(determinant(r)).toBeCloseTo(1, 12);
        // The full homogeneous matrix too (it is block diagonal with a 1).
        expect(determinant(rotation(n, a, b, theta))).toBeCloseTo(1, 12);
      }
    }
  });

  it('only moves points within the rotation plane', () => {
    const r = rotation(4, 0, 3, Math.PI / 2); // xw
    // x rotates towards w
    expect(applyPoint(r, [1, 0, 0, 0]).map((v) => +v.toFixed(12))).toEqual([0, 0, 0, 1]);
    expect(applyPoint(r, [0, 0, 0, 1]).map((v) => +v.toFixed(12))).toEqual([-1, 0, 0, 0]);
    // y and z are untouched
    expect(applyPoint(r, [0, 2, 3, 0]).map((v) => +v.toFixed(12))).toEqual([0, 2, 3, 0]);
  });

  it('commute for planes with no shared axis (xy, zw)', () => {
    const xy = rotation(4, 0, 1, 0.7);
    const zw = rotation(4, 2, 3, 1.3);
    expect(maxAbsDiff(multiply(xy, zw), multiply(zw, xy))).toBeLessThan(1e-12);
  });

  it('do not commute for planes that share an axis (xy, yz)', () => {
    const xy = rotation(4, 0, 1, 0.7);
    const yz = rotation(4, 1, 2, 1.3);
    expect(maxAbsDiff(multiply(xy, yz), multiply(yz, xy))).toBeGreaterThan(0.1);
  });

  it('is inverted by rotating back', () => {
    const m = multiply(rotation(5, 1, 4, 0.4), rotation(5, 4, 1, 0.4));
    expect(maxAbsDiff(m, identity(6))).toBeLessThan(1e-12);
  });
});

describe('matrix utilities', () => {
  it('inverts and solves', () => {
    const a = [
      [4, 1, 2],
      [1, 3, 0],
      [2, 0, 5],
    ];
    const inv = inverse(a)!;
    expect(maxAbsDiff(multiply(a, inv), identity(3))).toBeLessThan(1e-12);
    const x = solve(a, [1, 2, 3])!;
    const ax = a.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
    expect(ax[0]).toBeCloseTo(1, 12);
    expect(ax[1]).toBeCloseTo(2, 12);
    expect(ax[2]).toBeCloseTo(3, 12);
    expect(inverse([
      [1, 2],
      [2, 4],
    ])).toBeNull();
  });

  it('computes determinants', () => {
    expect(determinant([
      [0, 1],
      [1, 0],
    ])).toBeCloseTo(-1);
    expect(determinant(scaling(4, 'uniform', 2))).toBeCloseTo(16);
  });

  it('finds eigenvalues and singular values', () => {
    expect(symmetricEigenvalues([
      [2, 1],
      [1, 2],
    ]).map((v) => +v.toFixed(10))).toEqual([1, 3]);
    const m = multiply(rotation(4, 0, 2, 0.3), multiply(scaling(4, 1, 3), rotation(4, 1, 3, 1.1)));
    const sv = singularValues(linearPart(m));
    expect(sv.map((v) => +v.toFixed(9))).toEqual([1, 1, 1, 3]);
  });
});

describe('transform stacks', () => {
  const ops: TransformOpSpec[] = [
    { kind: 'rotate', plane: [0, 3], angle: 30 },
    { kind: 'scale', axis: 1, factor: 2 },
    { kind: 'rotate', plane: [1, 2], angle: 45 },
    { kind: 'translate', axis: 3, amount: 0.5 },
  ];

  it('applies operations in list order', () => {
    const { matrix } = composeStack(4, ops);
    const p = [0.3, -0.2, 0.9, 0.1];
    let q = p;
    q = applyPoint(rotation(4, 0, 3, (30 * Math.PI) / 180), q);
    q = applyPoint(scaling(4, 1, 2), q);
    q = applyPoint(rotation(4, 1, 2, (45 * Math.PI) / 180), q);
    q = applyPoint(translation(4, 3, 0.5), q);
    const r = applyPoint(matrix, p);
    for (let i = 0; i < 4; i++) expect(r[i]).toBeCloseTo(q[i], 12);
  });

  it('produces an exact inverse', () => {
    const { matrix, inverse: inv } = composeStack(4, ops);
    expect(maxAbsDiff(multiply(matrix, inv), identity(5))).toBeLessThan(1e-12);
    expect(maxAbsDiff(inv, inverse(matrix)!)).toBeLessThan(1e-12);
  });

  it('reports stretch range', () => {
    const [lo, hi] = stretchRange(composeStack(4, ops).matrix);
    expect(lo).toBeCloseTo(1, 9);
    expect(hi).toBeCloseTo(2, 9);
  });

  it('shows order matters for xy/yz but not xy/zw', () => {
    const rot = (p: string, angle: number): TransformOpSpec => ({ kind: 'rotate', plane: parsePlane(p), angle });
    const both = (first: TransformOpSpec, second: TransformOpSpec) => [
      composeStack(4, [first, second]).matrix,
      composeStack(4, [second, first]).matrix,
    ];
    const [xyZw, zwXy] = both(rot('xy', 50), rot('zw', 70));
    expect(maxAbsDiff(xyZw, zwXy)).toBeLessThan(1e-12);
    const [xyYz, yzXy] = both(rot('xy', 50), rot('yz', 70));
    expect(maxAbsDiff(xyYz, yzXy)).toBeGreaterThan(0.1);
  });

  it('skips ops that do not fit the dimension', () => {
    const { matrix } = composeStack(3, [{ kind: 'rotate', plane: [0, 3], angle: 30 }]);
    expect(maxAbsDiff(matrix, identity(4))).toBe(0);
  });

  it('keeps transposes consistent', () => {
    const r = linearPart(rotation(6, 2, 5, 0.9));
    expect(maxAbsDiff(transpose(r), inverse(r)!)).toBeLessThan(1e-12);
  });
});
