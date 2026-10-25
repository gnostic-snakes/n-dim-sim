/**
 * 3D polyhedra built from vertex lists (used for Flatland mode and as bases of
 * 4D polyhedral prisms).
 */
import { convexHull3 } from '../math/hull3';
import type { Facet } from '../math/slice';
import { cross3, dot, normalize, sub, type Vec } from '../math/vec';

const PHI = (1 + Math.sqrt(5)) / 2;

/** Facets of the convex hull of 3D points, with coplanar hull triangles merged. */
export function hullFacets3(vertices: Vec[]): Facet[] {
  const hull = convexHull3(vertices);
  if (!hull) throw new Error('Degenerate polyhedron');
  const facets: Facet[] = [];
  for (const [a, b, c] of hull.faces) {
    const n = normalize(cross3(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a])));
    const off = dot(n, vertices[a]);
    if (!facets.some((f) => dot(f.normal, n) > 1 - 1e-9 && Math.abs(f.offset - off) < 1e-9)) {
      facets.push({ normal: n, offset: off });
    }
  }
  return facets;
}

function signs(v: Vec, mask: boolean[]): Vec[] {
  // All sign combinations on the masked coordinates.
  let out: Vec[] = [v.slice()];
  v.forEach((_, i) => {
    if (!mask[i] || v[i] === 0) return;
    out = out.flatMap((u) => {
      const w = u.slice();
      w[i] = -w[i];
      return [u, w];
    });
  });
  return out;
}

function cyclic(v: Vec): Vec[] {
  return [v, [v[1], v[2], v[0]], [v[2], v[0], v[1]]];
}

export function icosahedronVertices(): Vec[] {
  return cyclic([0, 1, PHI]).flatMap((v) => signs(v, [true, true, true]));
}

export function dodecahedronVertices(): Vec[] {
  return [...signs([1, 1, 1], [true, true, true]), ...cyclic([0, 1 / PHI, PHI]).flatMap((v) => signs(v, [true, true, true]))];
}
