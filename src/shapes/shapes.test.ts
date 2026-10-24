import { describe, expect, it } from 'vitest';
import { compileJS } from '../math/sdf';
import { sliceConvexPolytope } from '../math/slice';
import { composeStack } from '../math/transforms';
import { dot, norm } from '../math/vec';
import { cell120, cell24, cell600 } from './polytopes';
import { defaultOptions, defaultParams, getShape, scaledFacets, SHAPES, sdfValues, shapesForDim } from './registry';

describe('polytope data', () => {
  const polytopes = SHAPES.filter((s) => s.kind === 'polytope');
  for (const def of polytopes) {
    for (let n = 3; n <= 8; n++) {
      if (!def.dims(n) || def.kind !== 'polytope') continue;
      if (n > 6 && def.id === 'simplex') continue; // fine but slow-ish to check exhaustively
      it(`${def.name(n, defaultOptions(def))} (${n}D) is consistent`, () => {
        const g = def.geometry(n, defaultOptions(def));
        expect(g.dim).toBe(n);
        expect(g.vertices.length).toBe(g.faceCounts[0]);
        expect(g.edges.length).toBe(g.faceCounts[1]);
        expect(g.facets.length).toBe(g.faceCounts[n - 1]);
        let maxR = 0;
        for (const v of g.vertices) {
          maxR = Math.max(maxR, norm(v));
          for (const f of g.facets) expect(dot(f.normal, v)).toBeLessThanOrEqual(f.offset + 1e-9);
        }
        expect(maxR).toBeCloseTo(1, 9);
        for (const f of g.facets) expect(norm(f.normal)).toBeCloseTo(1, 12);
        // Each facet is an (n-1)-polytope, so it carries at least n vertices.
        for (const fv of g.facetVertices) expect(fv.length).toBeGreaterThanOrEqual(n);
        // Euler characteristic of the boundary: sum (-1)^k f_k = 1 - (-1)^n.
        const chi = g.faceCounts.reduce((s, f, k) => s + (k % 2 === 0 ? f : -f), 0);
        expect(chi).toBe(1 - (-1) ** n);
      });
    }
  }

  it('600-cell and 120-cell have the right cell structure', () => {
    expect(cell600().facetVertices.every((f) => f.length === 4)).toBe(true);
    expect(cell120().facetVertices.every((f) => f.length === 20)).toBe(true);
    expect(cell24().facetVertices.every((f) => f.length === 6)).toBe(true);
  });

  it('slices the big polytopes quickly', () => {
    const g = cell600();
    const facets = scaledFacets(g, 2);
    const t0 = performance.now();
    let frames = 0;
    for (let i = 0; i < 60; i++) {
      const { inverse } = composeStack(4, [
        { kind: 'rotate', plane: [0, 3], angle: i * 3 },
        { kind: 'rotate', plane: [1, 2], angle: i * 2 },
      ]);
      const s = sliceConvexPolytope({ facets, inverse, hidden: [0.1], k: 3, bound: { center: [0, 0, 0], radius: 2 } });
      if (s?.exact) frames++;
    }
    const ms = (performance.now() - t0) / 60;
    expect(frames).toBe(60);
    // Generous bound: this runs every animation frame in the browser.
    expect(ms).toBeLessThan(40);
  });
});

describe('curved shapes', () => {
  const curved = SHAPES.filter((s) => s.kind === 'sdf');
  for (const def of curved) {
    if (def.kind !== 'sdf') continue;
    const n = [3, 4, 5].find((d) => def.dims(d))!;
    it(`${def.name(n, {})} has a sane SDF and wireframe`, () => {
      const params = defaultParams(def);
      const f = compileJS(def.sdf(n, defaultOptions(def)));
      const vals = sdfValues(def, params);
      const R = def.boundingRadius(n, params, {});
      // Outside the bounding ball the SDF must be positive.
      for (let i = 0; i < 50; i++) {
        const v = Array.from({ length: n }, (_, j) => Math.sin(i * 7.3 + j * 1.7));
        const l = norm(v);
        const p = v.map((x) => (x / l) * R * 1.01);
        expect(f(p, vals)).toBeGreaterThan(0);
      }
      // The wireframe stays close to the surface (within the bounding ball).
      const lines = def.wireframe(n, params, {});
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) for (const p of line) expect(norm(p)).toBeLessThanOrEqual(R * 1.0001 + 1e-9);
      // Lipschitz: |f(a) - f(b)| <= |a - b| on random pairs.
      for (let i = 0; i < 200; i++) {
        const a = Array.from({ length: n }, (_, j) => Math.sin(i * 3.1 + j) * R);
        const b = a.map((x, j) => x + Math.cos(i * 1.3 + j * 2.1) * 0.1);
        const d = Math.hypot(...a.map((x, j) => x - b[j]));
        expect(Math.abs(f(a, vals) - f(b, vals))).toBeLessThanOrEqual(d * (1 + 1e-9));
      }
    });
  }
});

describe('registry', () => {
  it('offers shapes in every dimension', () => {
    for (let n = 3; n <= 8; n++) expect(shapesForDim(n).length).toBeGreaterThanOrEqual(4);
    expect(shapesForDim(4).map((s) => s.id)).toEqual(
      expect.arrayContaining(['hypercube', 'simplex', 'cross', 'cell24', 'cell600', 'cell120', 'ball', 'duocylinder', 'clifford']),
    );
  });

  it('names shapes by dimension', () => {
    expect(getShape('hypercube').name(4, {})).toBe('Tesseract');
    expect(getShape('cross').name(4, {})).toBe('16-cell');
    expect(getShape('simplex').name(4, {})).toBe('5-cell');
    expect(getShape('hypercube').name(3, {})).toBe('Cube');
  });
});
