/**
 * WebGL2 renderer for the slice view.
 *
 * Per frame: upload slice planes for polytopes (uniform buffer) and their
 * per-plane metadata (cell id, hidden normal) to a float texture, set the
 * uniforms of the generated SDF slots, trace into an offscreen target and
 * blit to the canvas. While nothing changes it keeps rendering jittered
 * frames into an accumulation buffer, converging to a clean anti-aliased
 * image.
 */
import { cameraBasis, type CameraController } from './camera';
import { createProgram, createTarget, DataTexture, deleteTarget, hexToLinear, type Program, type RenderTarget } from './gl';
import { BLIT_FS, buildFlatShader, buildSceneShader, FULLSCREEN_VS, MAX_PLANES, MAX_POLY, MAX_SDF, type SdfSlot } from './shaders';
import type { FrameData, ObjectFrame } from '../scene/frame';
import type { ShadingMode } from '../scene/model';
import { exprParams } from '../math/sdf';
import type { SdfShapeDef } from '../shapes/types';

const SHADING_ID: Record<ShadingMode, number> = { solid: 0, cells: 1, tilt: 2, depth: 3 };
const DEFAULT_SAMPLES = 48;

export interface RenderStats {
  planes: number;
  samples: number;
  scale: number;
  ms: number;
}

function halton(i: number, b: number): number {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}

interface Compiled {
  key: string;
  program: Program;
  slots: { obj: string; slot: SdfSlot }[];
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private ubo: WebGLBuffer;
  private uboData = new Float32Array(MAX_PLANES * 4);
  private meta: DataTexture;
  private metaData = new Float32Array(MAX_PLANES * 4);
  private blit: Program;
  private compiled: Compiled | null = null;
  private target: RenderTarget | null = null;
  private floatTargets: boolean;
  private sample = 0;
  private still = 0;
  private lastKey = '';
  /** Fraction of full resolution used for the scene pass (adapted to frame time). */
  scale = 1;
  autoScale = true;
  /** Number of jittered samples accumulated for a still image. */
  maxSamples = DEFAULT_SAMPLES;
  lastError: string | null = null;
  stats: RenderStats = { planes: 0, samples: 0, scale: 1, ms: 0 };
  private frameTimes: number[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.ubo = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, this.uboData.byteLength, gl.DYNAMIC_DRAW);
    this.meta = new DataTexture(gl);
    this.blit = this.makeProgram(BLIT_FS);
  }

  private makeProgram(fs: string): Program {
    const gl = this.gl;
    const p = createProgram(gl, FULLSCREEN_VS.replace('in vec2 aPos;', 'layout(location = 0) in vec2 aPos;'), fs);
    const blockIndex = gl.getUniformBlockIndex(p.program, 'PlaneBlock');
    if (blockIndex !== gl.INVALID_INDEX) gl.uniformBlockBinding(p.program, blockIndex, 0);
    return p;
  }

  /** Reset progressive accumulation (call when anything visible changes). */
  invalidate() {
    this.sample = 0;
  }

  /** True once the still image has fully converged (no more frames needed). */
  get converged(): boolean {
    return this.sample >= this.maxSamples;
  }

  private ensureProgram(frame: FrameData) {
    const sdfObjects = frame.objects.filter((o) => o.def.kind === 'sdf' && o.obj.visible).slice(0, MAX_SDF);
    const slots = sdfObjects.map((o) => {
      const def = o.def as SdfShapeDef;
      const expr = def.sdf(o.n, o.obj.options);
      return { obj: o.obj.id, slot: { expr, n: o.n, params: exprParams(expr) } };
    });
    const key = `${frame.k}|${slots.map((s) => JSON.stringify(s.slot.expr) + s.slot.n).join('|')}`;
    if (this.compiled?.key === key) {
      // Same shader; slots may belong to different object ids now.
      this.compiled.slots = slots;
      return;
    }
    const fs = frame.k === 2 ? buildFlatShader(slots.map((s) => s.slot)) : buildSceneShader(slots.map((s) => s.slot));
    if (this.compiled) this.gl.deleteProgram(this.compiled.program.program);
    this.compiled = { key, program: this.makeProgram(fs), slots };
  }

  private ensureTarget(w: number, h: number) {
    if (this.target && this.target.width === w && this.target.height === h) return;
    deleteTarget(this.gl, this.target);
    this.target = createTarget(this.gl, w, h, this.floatTargets);
    this.sample = 0;
    this.still = 0;
  }

  /**
   * Render the slice view. `cssWidth/cssHeight` is the canvas size in CSS pixels.
   * `key` must change whenever anything visible changes (it resets accumulation).
   */
  render(frame: FrameData, camera: CameraController, opts: { cssWidth: number; cssHeight: number; dpr: number; key: string; highlight: number }) {
    const t0 = performance.now();
    const gl = this.gl;
    const fullW = Math.max(1, Math.round(opts.cssWidth * opts.dpr));
    const fullH = Math.max(1, Math.round(opts.cssHeight * opts.dpr));
    if (this.canvas.width !== fullW || this.canvas.height !== fullH) {
      this.canvas.width = fullW;
      this.canvas.height = fullH;
    }
    if (opts.key !== this.lastKey) {
      this.lastKey = opts.key;
      this.still = 0;
    } else {
      this.still++;
    }
    // While things move, render a reduced-resolution frame into a corner of the
    // full-size target; once still, accumulate jittered full-resolution samples.
    const scale = this.still === 0 && this.autoScale ? this.scale : 1;
    const w = Math.max(1, Math.round(fullW * scale));
    const h = Math.max(1, Math.round(fullH * scale));
    this.ensureTarget(fullW, fullH);
    if (this.still <= 1) this.sample = 0;

    try {
      this.ensureProgram(frame);
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return;
    }
    const compiled = this.compiled!;
    const prog = compiled.program;
    gl.useProgram(prog.program);

    const planes = this.uploadPlanes(frame, prog);
    this.setSdfUniforms(frame, compiled);
    this.setCommonUniforms(frame, camera, prog, w, h, opts);

    const jitter = this.sample === 0 ? [0, 0] : [halton(this.sample, 2) - 0.5, halton(this.sample, 3) - 0.5];
    gl.uniform2f(prog.loc('uJitter'), jitter[0], jitter[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target!.fbo);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    if (this.sample > 0) {
      // Running average: blend with weight 1 / (n + 1).
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, 1 / (this.sample + 1));
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, fullW, fullH);
    gl.useProgram(this.blit.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.target!.tex);
    gl.uniform1i(this.blit.loc('uTex'), 0);
    gl.uniform2f(this.blit.loc('uSize'), fullW, fullH);
    gl.uniform2f(this.blit.loc('uUvScale'), w / fullW, h / fullH);
    gl.uniform1f(this.blit.loc('uFrame'), this.sample);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.sample = Math.min(this.sample + 1, this.maxSamples);
    this.stats = { planes, samples: this.sample, scale, ms: performance.now() - t0 };
  }

  /** Report the measured interval between animation frames so resolution can adapt to GPU load. */
  reportFrameInterval(ms: number) {
    if (!this.autoScale) return;
    this.frameTimes.push(ms);
    if (this.frameTimes.length < 10) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    this.frameTimes = [];
    if (med > 24 && this.scale > 0.35) this.scale = Math.max(0.35, this.scale * 0.85);
    else if (med < 18 && this.scale < 1) this.scale = Math.min(1, this.scale * 1.1);
  }

  private uploadPlanes(frame: FrameData, prog: Program): number {
    const gl = this.gl;
    const ubo = this.uboData;
    const meta = this.metaData;
    let count = 0;
    let slot = 0;
    const info = new Int32Array(MAX_POLY * 4);
    const bound = new Float32Array(MAX_POLY * 4);
    const color = new Float32Array(MAX_POLY * 4);
    const depth = new Float32Array(MAX_POLY * 4);
    const depthScale = new Float32Array(MAX_POLY);
    for (const o of frame.objects) {
      if (o.def.kind !== 'polytope' || !o.polytope || slot >= MAX_POLY) continue;
      const planes = o.visible ? o.polytope.planes : [];
      if (count + planes.length > MAX_PLANES) continue;
      const start = count;
      for (const pl of planes) {
        const b = count * 4;
        ubo[b] = pl.normal[0];
        ubo[b + 1] = pl.normal[1];
        ubo[b + 2] = pl.normal[2] ?? 0;
        ubo[b + 3] = pl.offset;
        const hn = pl.hiddenNormal;
        meta[b] = pl.facets[0];
        meta[b + 1] = Math.hypot(...hn);
        meta[b + 2] = hn[0] ?? 0;
        meta[b + 3] = hn[1] ?? 0;
        count++;
      }
      info.set([start, planes.length, o.index, 0], slot * 4);
      const sb = o.sliceBall;
      if (sb && planes.length > 0) bound.set([sb.center[0], sb.center[1], sb.center[2] ?? 0, sb.radius * 1.002 + 1e-4], slot * 4);
      const c = hexToLinear(o.obj.color);
      color.set([c[0], c[1], c[2], o.index], slot * 4);
      const row = o.L[Math.min(o.k, o.n - 1)];
      depth.set([row[0], row[1], row[2] ?? 0, o.t0[Math.min(o.k, o.n - 1)]], slot * 4);
      depthScale[slot] = 1 / Math.max(1e-6, o.polytope.size * o.polytope.geometry.circumradius);
      slot++;
    }
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, ubo, 0, Math.max(4, count * 4));
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);
    this.meta.upload(meta, Math.max(1, count));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.meta.texture);
    gl.uniform1i(prog.loc('uMeta'), 1);
    gl.uniform1i(prog.loc('uPolyCount'), slot);
    gl.uniform4iv(prog.loc('uPolyInfo'), info);
    gl.uniform4fv(prog.loc('uPolyBound'), bound);
    gl.uniform4fv(prog.loc('uPolyColor'), color);
    gl.uniform4fv(prog.loc('uPolyDepth'), depth);
    gl.uniform1fv(prog.loc('uPolyDepthScale'), depthScale);
    return count;
  }

  private setSdfUniforms(frame: FrameData, compiled: Compiled) {
    const gl = this.gl;
    const prog = compiled.program;
    const byId = new Map<string, ObjectFrame>(frame.objects.map((o) => [o.obj.id, o]));
    compiled.slots.forEach(({ obj, slot }, s) => {
      const o = byId.get(obj);
      if (!o) {
        gl.uniform4f(prog.loc(`uSdfBound${s}`), 0, 0, 0, -1);
        return;
      }
      const N = slot.n;
      const rows = new Float32Array(N * 4);
      const hid = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        rows.set([o.L[i][0], o.L[i][1], o.L[i][2] ?? 0, o.t0[i]], i * 4);
        for (let j = 0; j < 4; j++) hid[i * 4 + j] = o.hiddenCols[i][j] ?? 0;
      }
      gl.uniform4fv(prog.loc(`uSdfRow${s}`), rows);
      gl.uniform4fv(prog.loc(`uSdfHid${s}`), hid);
      const vals = o.sdf?.values ?? {};
      const par = new Float32Array(Math.max(1, Math.ceil(slot.params.length / 4)) * 4);
      slot.params.forEach((name, j) => (par[j] = vals[name] ?? 0));
      gl.uniform4fv(prog.loc(`uSdfPar${s}`), par);
      const sb = o.visible ? o.sliceBall : null;
      if (sb) gl.uniform4f(prog.loc(`uSdfBound${s}`), sb.center[0], sb.center[1], sb.center[2] ?? 0, sb.radius * 1.002 + 1e-4);
      else gl.uniform4f(prog.loc(`uSdfBound${s}`), 0, 0, 0, -1);
      const c = hexToLinear(o.obj.color);
      gl.uniform4f(prog.loc(`uSdfColor${s}`), c[0], c[1], c[2], o.index);
      const shapeRadius = o.def.boundingRadius(o.n, o.obj.params, o.obj.options);
      gl.uniform2f(prog.loc(`uSdfScale${s}`), o.sdf?.lip ?? 1, 1 / Math.max(1e-6, shapeRadius));
    });
  }

  private setCommonUniforms(
    frame: FrameData,
    camera: CameraController,
    prog: Program,
    w: number,
    h: number,
    opts: { dpr: number; highlight: number; cssHeight: number },
  ) {
    const gl = this.gl;
    const view = frame.scene.view;
    gl.uniform4f(prog.loc('uViewport'), 0, 0, w, h);
    gl.uniform1i(prog.loc('uShading'), SHADING_ID[view.shading]);
    gl.uniform1i(prog.loc('uEdges'), (view.edges ? 1 : 0) | (view.hiddenEdges ? 2 : 0));
    gl.uniform1i(prog.loc('uHighlight'), opts.highlight);
    gl.uniform3f(prog.loc('uBgTop'), 0.05, 0.062, 0.09);
    gl.uniform3f(prog.loc('uBgBottom'), 0.012, 0.014, 0.022);
    if (frame.k === 2) {
      gl.uniform2f(prog.loc('uFlatCenter'), camera.flat.center[0], camera.flat.center[1]);
      gl.uniform1f(prog.loc('uUnitsPerPx'), camera.flat.unitsPerPx);
      // Target pixels -> CSS pixels.
      gl.uniform1f(prog.loc('uPxScale'), opts.cssHeight / h);
      return;
    }
    const b = cameraBasis(camera.orbit);
    gl.uniform3fv(prog.loc('uEye'), b.eye);
    gl.uniform3fv(prog.loc('uRight'), b.right);
    gl.uniform3fv(prog.loc('uUp'), b.up);
    gl.uniform3fv(prog.loc('uFwd'), b.forward);
    gl.uniform1f(prog.loc('uTanHalfFov'), b.tanHalfFov);
    gl.uniform1f(prog.loc('uPixelAngle'), (2 * b.tanHalfFov) / h);
    const key = normalize3([-b.right[0] * 0.45 - b.forward[0] * 0.35, 1 - b.forward[1] * 0.35 - b.right[1] * 0.45, -b.right[2] * 0.45 - b.forward[2] * 0.35]);
    gl.uniform3fv(prog.loc('uKeyDir'), key);
    gl.uniform3fv(prog.loc('uFillDir'), normalize3([b.right[0] * 0.8 - b.forward[0] * 0.3, -0.25, b.right[2] * 0.8 - b.forward[2] * 0.3]));
    let floorY = Infinity;
    for (const o of frame.objects) floorY = Math.min(floorY, o.center[1] - o.radius);
    if (!Number.isFinite(floorY)) floorY = -2;
    gl.uniform1i(prog.loc('uFloor'), view.floor ? 1 : 0);
    gl.uniform1f(prog.loc('uFloorY'), Math.min(floorY - 0.3, -1));
    gl.uniform1i(prog.loc('uShadows'), view.shadows ? 1 : 0);
  }

  dispose() {
    const gl = this.gl;
    deleteTarget(gl, this.target);
    this.target = null;
    if (this.compiled) gl.deleteProgram(this.compiled.program.program);
    this.compiled = null;
    gl.deleteProgram(this.blit.program);
    gl.deleteBuffer(this.ubo);
    gl.deleteVertexArray(this.vao);
  }
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
