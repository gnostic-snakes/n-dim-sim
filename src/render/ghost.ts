/**
 * The context inset ("ghost view"): the whole n-D shape, projected down to a
 * small 3D view, coloured by position along the hidden axis, with the slice
 * drawn where it really sits.
 *
 * Projection modes:
 *  - shadow: drop the hidden coordinates (orthographic). The slice sits at its
 *    true xyz position inside the shape's shadow.
 *  - perspective: perspective-divide each hidden axis away, like the classic
 *    "cube inside a cube" tesseract picture.
 *  - side: show x, y and one hidden axis instead of z. The slicing hyperplane
 *    becomes a flat sheet you can see edge-on.
 */
import { applyPoint } from '../math/homogeneous';
import type { Vec } from '../math/vec';
import type { FrameData, ObjectFrame } from '../scene/frame';
import type { GhostMode } from '../scene/model';
import type { SdfShapeDef, SurfaceShapeDef } from '../shapes/types';

export interface GhostOptions {
  mode: GhostMode;
  sideAxis: number;
  yaw: number;
  pitch: number;
  selectedId: string | null;
}

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  depth: number;
  color: string;
  width: number;
}

const wireCache = new Map<string, Vec[][]>();

function wireframe(o: ObjectFrame): Vec[][] {
  if (o.polytope) {
    const g = o.polytope.geometry;
    const s = o.polytope.size;
    return g.edges.map(([a, b]) => [g.vertices[a].map((x) => x * s), g.vertices[b].map((x) => x * s)]);
  }
  const def = o.def as SdfShapeDef | SurfaceShapeDef;
  const key = `${def.id}|${o.n}|${JSON.stringify(o.obj.params)}|${JSON.stringify(o.obj.options)}`;
  let w = wireCache.get(key);
  if (!w) {
    w = def.wireframe(o.n, o.obj.params, o.obj.options);
    if (wireCache.size > 64) wireCache.clear();
    wireCache.set(key, w);
  }
  return w;
}

/** Diverging colour for a signed hidden offset in [-1, 1]: blue below the slice, orange above. */
function hiddenColor(t: number, alpha: number): string {
  const s = Math.max(-1, Math.min(1, t));
  const n = [205, 205, 200];
  const warm = [250, 107, 26];
  const cool = [26, 107, 250];
  const c = s >= 0 ? warm : cool;
  const u = Math.pow(Math.abs(s), 0.7);
  const r = Math.round(n[0] + (c[0] - n[0]) * u);
  const g = Math.round(n[1] + (c[1] - n[1]) * u);
  const b = Math.round(n[2] + (c[2] - n[2]) * u);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

export class GhostRenderer {
  constructor(private canvas: HTMLCanvasElement) {}

  draw(frame: FrameData, opts: GhostOptions) {
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const { n, k } = frame;
    const slice = frame.scene.slice;
    const flat = k === 2;
    const mode: GhostMode = flat ? 'shadow' : opts.mode;
    const sideAxis = Math.min(Math.max(opts.sideAxis, k), n - 1);

    // Overall extent for fitting and colour normalisation.
    let R = 0.5;
    for (const o of frame.objects) {
      let c2 = 0;
      for (let i = 0; i < n; i++) c2 += o.center[i] ** 2;
      R = Math.max(R, Math.sqrt(c2) + o.radius);
    }
    const camD = 3 * R; // 4D (n-D) camera distance for perspective mode

    /** n-D world point -> 3D point in the ghost space. */
    const to3 = (p: Vec): [number, number, number] => {
      if (flat) return [p[0], p[1], p[2]];
      if (mode === 'side') return [p[0], p[1], p[sideAxis]];
      if (mode === 'perspective') {
        const q = p.slice();
        for (let j = n - 1; j >= 3; j--) {
          const f = camD / Math.max(camD - q[j], camD * 0.15);
          for (let i = 0; i < j; i++) q[i] *= f;
        }
        return [q[0], q[1], q[2]];
      }
      return [p[0], p[1], p[2]];
    };

    // 3D -> screen with the ghost orbit camera (perspective).
    const cy = Math.cos(opts.yaw);
    const sy = Math.sin(opts.yaw);
    const cp = Math.cos(opts.pitch);
    const sp = Math.sin(opts.pitch);
    const fitR = mode === 'perspective' ? R * 1.5 : R;
    const camDist = fitR * 3.2;
    // A sphere of radius fitR at distance camDist should fill ~92% of the shorter side.
    const focal = (0.46 * Math.min(W, H) * Math.sqrt(camDist * camDist - fitR * fitR)) / fitR;
    const toScreen = (v: [number, number, number]): [number, number, number] => {
      // Camera looks at the origin from (yaw, pitch); right = (cos yaw, 0, -sin yaw).
      const x1 = v[0] * cy - v[2] * sy;
      const z1 = v[0] * sy + v[2] * cy;
      const y2 = v[1] * cp - z1 * sp;
      const z2 = v[1] * sp + z1 * cp;
      const depth = camDist - z2;
      const f = focal / Math.max(depth, 1e-3);
      return [W / 2 + x1 * f, H / 2 - y2 * f, depth];
    };
    const project = (p: Vec) => toScreen(to3(p));

    const segs: Seg[] = [];
    const lineW = 1.15 * dpr;
    const hid = (p: Vec) => (flat ? p[2] - slice[0] : p[k] - slice[0]);
    const otherHidden = (p: Vec) => {
      let s = 0;
      for (let j = k + 1; j < n; j++) s += (p[j] - slice[j - k]) ** 2;
      return Math.sqrt(s);
    };

    const dots: { x: number; y: number }[] = [];
    for (const o of frame.objects) {
      if (!o.obj.visible) continue;
      const dim = o.obj.id === opts.selectedId || frame.objects.length === 1 ? 1 : 0.55;
      for (const line of wireframe(o)) {
        const world = line.map((p) => applyPoint(o.matrix, p));
        for (let i = 0; i + 1 < world.length; i++) {
          const a = world[i];
          const b = world[i + 1];
          const ha = hid(a);
          const hb = hid(b);
          // Split at the slice so colours change exactly where the shape crosses our world.
          const pieces: [Vec, Vec][] = [];
          if (ha * hb < 0 && n - k === 1 && o.def.kind === 'sdf') {
            const t = ha / (ha - hb);
            const m = a.map((x, j) => x + (b[j] - x) * t);
            pieces.push([a, m], [m, b]);
            const s = project(m);
            dots.push({ x: s[0], y: s[1] });
          } else pieces.push([a, b]);
          for (const [p, q] of pieces) {
            const sa = project(p);
            const sb = project(q);
            const mid = p.map((x, j) => (x + q[j]) / 2);
            const fade = Math.exp(-otherHidden(mid) / (0.6 * R));
            const depthAlpha = 0.35 + 0.65 * Math.max(0, Math.min(1, (camDist + fitR - (sa[2] + sb[2]) / 2) / (2 * fitR)));
            segs.push({
              ax: sa[0],
              ay: sa[1],
              bx: sb[0],
              by: sb[1],
              depth: (sa[2] + sb[2]) / 2,
              color: hiddenColor(hid(mid) / R, (0.25 + 0.6 * depthAlpha) * dim * fade),
              width: lineW,
            });
          }
        }
      }
    }

    // The slicing hyperplane as a sheet (side view and Flatland).
    if (mode === 'side' || flat) {
      const s0 = slice[0];
      const corners: [number, number, number][] = flat
        ? [
            [-R, -R, s0],
            [R, -R, s0],
            [R, R, s0],
            [-R, R, s0],
          ]
        : [
            [-R, -R, slice[sideAxis - k]],
            [R, -R, slice[sideAxis - k]],
            [R, R, slice[sideAxis - k]],
            [-R, R, slice[sideAxis - k]],
          ];
      const pts = corners.map(toScreen);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = 'rgba(108,195,213,0.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(108,195,213,0.45)';
      ctx.lineWidth = dpr;
      ctx.stroke();
    }

    segs.sort((a, b) => b.depth - a.depth);
    ctx.lineCap = 'round';
    for (const s of segs) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.bx, s.by);
      ctx.stroke();
    }

    // The exact slice of each polytope.
    for (const o of frame.objects) {
      const sl = o.polytope?.slice;
      if (!o.obj.visible || !sl || !sl.exact) continue;
      const lift = (q: Vec): Vec => {
        const p = new Array(n).fill(0);
        for (let i = 0; i < k; i++) p[i] = q[i];
        for (let j = k; j < n; j++) p[j] = slice[j - k];
        return p;
      };
      const pv = sl.vertices.map((q) => project(lift(q)));
      if (k === 3) {
        const faces = sl.faces
          .map((f) => ({ f, depth: f.loop.reduce((s, i) => s + pv[i][2], 0) / f.loop.length }))
          .sort((a, b) => b.depth - a.depth);
        for (const { f } of faces) {
          ctx.beginPath();
          f.loop.forEach((i, j) => (j ? ctx.lineTo(pv[i][0], pv[i][1]) : ctx.moveTo(pv[i][0], pv[i][1])));
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 214, 140, 0.13)';
          ctx.fill();
        }
      }
      ctx.strokeStyle = 'rgba(255, 236, 200, 0.95)';
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      for (const [a, b] of sl.edges) {
        ctx.moveTo(pv[a][0], pv[a][1]);
        ctx.lineTo(pv[b][0], pv[b][1]);
      }
      ctx.stroke();
    }

    // Slice curves of thickened surfaces, drawn where they sit in the projection.
    for (const o of frame.objects) {
      const sf = o.surface;
      if (!o.obj.visible || !sf) continue;
      const lift = (q: Vec): Vec => {
        const p = new Array(n).fill(0);
        for (let i = 0; i < k; i++) p[i] = q[i];
        for (let j = k; j < n; j++) p[j] = slice[j - k];
        return p;
      };
      ctx.strokeStyle = 'rgba(255, 236, 200, 0.95)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      for (const sg of sf.segments) {
        const a = project(lift(sg.a));
        const b = project(lift(sg.b));
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }

    // Where curves cross the slice (curved shapes, one hidden axis).
    ctx.fillStyle = 'rgba(255, 236, 200, 0.95)';
    for (const d of dots) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.8 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Axis tripod in the corner.
    const axes = flat ? [0, 1, 2] : mode === 'side' ? [0, 1, sideAxis] : [0, 1, 2];
    const colors = ['#ef6b62', '#6fcf6f', '#5c9cf5', '#c678dd', '#e7a43a', '#2bb3a8', '#e06c9f', '#9aa0a6'];
    const names = 'xyzwvuts';
    const origin: [number, number] = [26 * dpr, H - 24 * dpr];
    const unit: [number, number, number][] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    ctx.font = `${10 * dpr}px ui-monospace, monospace`;
    unit.forEach((u, i) => {
      const x1 = u[0] * cy - u[2] * sy;
      const z1 = u[0] * sy + u[2] * cy;
      const y2 = u[1] * cp - z1 * sp;
      const ex = origin[0] + x1 * 14 * dpr;
      const ey = origin[1] - y2 * 14 * dpr;
      ctx.strokeStyle = colors[axes[i]];
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(origin[0], origin[1]);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = colors[axes[i]];
      ctx.fillText(names[axes[i]], ex + (ex - origin[0]) * 0.25 - 3 * dpr, ey + (ey - origin[1]) * 0.25 + 3 * dpr);
    });
  }
}
