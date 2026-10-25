/** Click-to-select: cast the same ray the shader does and find the nearest object. */
import { compileJS, type CompiledSdf } from '../math/sdf';
import type { FrameData, ObjectFrame } from '../scene/frame';
import { sdfValues } from '../shapes/registry';
import type { SdfShapeDef } from '../shapes/types';
import { cameraBasis, type CameraController } from './camera';

const sdfCache = new Map<string, CompiledSdf>();

function sliceSdf(o: ObjectFrame): ((q: number[]) => number) | null {
  if (o.def.kind !== 'sdf') return null;
  const def = o.def as SdfShapeDef;
  const key = `${def.id}|${o.n}|${JSON.stringify(o.obj.options)}`;
  let f = sdfCache.get(key);
  if (!f) {
    f = compileJS(def.sdf(o.n, o.obj.options));
    sdfCache.set(key, f);
  }
  const fn = f;
  const vals = sdfValues(def, o.obj.params);
  const lip = o.stretch[0];
  const p = new Array(o.n).fill(0);
  return (q) => {
    for (let i = 0; i < o.n; i++) {
      let s = o.t0[i];
      for (let d = 0; d < o.k; d++) s += o.L[i][d] * q[d];
      p[i] = s;
    }
    return fn(p, vals) * lip;
  };
}

function rayPolytope(o: ObjectFrame, ro: number[], rd: number[]): number | null {
  const planes = o.polytope?.planes ?? [];
  if (!o.visible || planes.length === 0) return null;
  let tIn = -Infinity;
  let tOut = Infinity;
  for (const pl of planes) {
    const dn = pl.normal[0] * rd[0] + pl.normal[1] * rd[1] + pl.normal[2] * rd[2];
    const num = pl.offset - (pl.normal[0] * ro[0] + pl.normal[1] * ro[1] + pl.normal[2] * ro[2]);
    if (Math.abs(dn) < 1e-12) {
      if (num < 0) return null;
      continue;
    }
    const t = num / dn;
    if (dn < 0) tIn = Math.max(tIn, t);
    else tOut = Math.min(tOut, t);
    if (tIn > tOut) return null;
  }
  if (tOut <= 0) return null;
  return tIn > 0 ? tIn : tOut;
}

function raySdf(o: ObjectFrame, ro: number[], rd: number[]): number | null {
  const ball = o.sliceBall;
  const f = sliceSdf(o);
  if (!o.visible || !ball || !f) return null;
  const oc = [ro[0] - ball.center[0], ro[1] - ball.center[1], ro[2] - ball.center[2]];
  const b = oc[0] * rd[0] + oc[1] * rd[1] + oc[2] * rd[2];
  const disc = b * b - (oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - ball.radius ** 2);
  if (disc < 0) return null;
  let t = Math.max(0, -b - Math.sqrt(disc));
  const tEnd = -b + Math.sqrt(disc);
  for (let i = 0; i < 300 && t <= tEnd; i++) {
    const d = f([ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t]);
    if (d < 1e-3) return t;
    t += Math.max(d, 1e-3);
  }
  return null;
}

function rayCapsule(ro: number[], rd: number[], pa: number[], pb: number[], r: number): number | null {
  const ba = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  const oa = [ro[0] - pa[0], ro[1] - pa[1], ro[2] - pa[2]];
  const d = (x: number[], y: number[]) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const baba = d(ba, ba);
  const bard = d(ba, rd);
  const baoa = d(ba, oa);
  const a = baba - bard * bard;
  const b = baba * d(rd, oa) - baoa * bard;
  const c = baba * d(oa, oa) - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h >= 0 && a > 1e-12) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t > 0 ? t : null;
  }
  let best: number | null = null;
  for (const oc of [oa, [ro[0] - pb[0], ro[1] - pb[1], ro[2] - pb[2]]]) {
    const bb = d(rd, oc);
    const hh = bb * bb - (d(oc, oc) - r * r);
    if (hh > 0) {
      const t = -bb - Math.sqrt(hh);
      if (t > 0 && (best === null || t < best)) best = t;
    }
  }
  return best;
}

function rayCurve(o: ObjectFrame, ro: number[], rd: number[]): number | null {
  const sf = o.surface;
  if (!o.visible || !sf) return null;
  let best: number | null = null;
  for (const s of sf.segments) {
    const t = rayCapsule(ro, rd, s.a, s.b, sf.tube);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Object id under the pixel (CSS px relative to the canvas), or null. */
export function pickObject(frame: FrameData, camera: CameraController, x: number, y: number, w: number, h: number): string | null {
  if (frame.k === 2) {
    const c = camera.flat;
    const q = [c.center[0] + (x - w / 2) * c.unitsPerPx, c.center[1] - (y - h / 2) * c.unitsPerPx];
    let hit: string | null = null;
    for (const o of frame.objects) {
      if (!o.visible) continue;
      if (o.polytope) {
        if (o.polytope.planes.length && o.polytope.planes.every((pl) => pl.normal[0] * q[0] + pl.normal[1] * q[1] <= pl.offset))
          hit = o.obj.id;
      } else {
        const f = sliceSdf(o);
        if (f && f(q) <= 0) hit = o.obj.id;
      }
    }
    return hit;
  }
  const b = cameraBasis(camera.orbit);
  const nx = (x / w) * 2 - 1;
  const ny = 1 - (y / h) * 2;
  const aspect = w / h;
  const d = [0, 1, 2].map((i) => b.forward[i] + b.right[i] * nx * b.tanHalfFov * aspect + b.up[i] * ny * b.tanHalfFov);
  const len = Math.hypot(d[0], d[1], d[2]);
  const rd = d.map((v) => v / len);
  const ro = [...b.eye];
  let best = Infinity;
  let id: string | null = null;
  for (const o of frame.objects) {
    const t = o.polytope ? rayPolytope(o, ro, rd) : o.def.kind === 'surface' ? rayCurve(o, ro, rd) : raySdf(o, ro, rd);
    if (t !== null && t < best) {
      best = t;
      id = o.obj.id;
    }
  }
  return id;
}
