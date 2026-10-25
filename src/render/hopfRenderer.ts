/**
 * Hopf fibration view: every fiber (a great circle of S³) is projected
 * stereographically to a circle in 3D and drawn as a shaded tube. One unit
 * tube mesh is instanced per circle; the vertex shader bends it into place.
 */
import type { Plane } from '../math/axes';
import { rotation } from '../math/homogeneous';
import { projectedFiber, type Circle3 } from '../math/hopf';
import { multiply } from '../math/mat';
import { cameraBasis, type CameraController } from './camera';
import { createProgram, createTarget, deleteTarget, GLError, type Program, type RenderTarget } from './gl';

export interface HopfSettings {
  /** Latitude bands on the base 2-sphere. */
  bands: number;
  /** Fibers per band. */
  perBand: number;
  /** Tube radius. */
  thickness: number;
  /** Current angle (radians) of the animated 4D rotation. */
  angle: number;
  plane: Plane;
}

export interface HopfFiber {
  circle: Circle3;
  color: [number, number, number];
  theta: number;
  phi: number;
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Base points on S² and the colour each fiber gets (shared with the base-sphere inset). */
export function hopfBasePoints(bands: number, perBand: number): { theta: number; phi: number; color: [number, number, number] }[] {
  const out: { theta: number; phi: number; color: [number, number, number] }[] = [];
  for (let j = 0; j < bands; j++) {
    const theta = (Math.PI * (j + 1)) / (bands + 1);
    for (let i = 0; i < perBand; i++) {
      const phi = (2 * Math.PI * i) / perBand + (j % 2 ? Math.PI / perBand : 0);
      const hue = phi / (2 * Math.PI);
      const light = 0.42 + 0.3 * (1 - theta / Math.PI);
      out.push({ theta, phi, color: hsl(hue, 0.72, light) });
    }
  }
  return out;
}

export function hopfFibers(s: HopfSettings): HopfFiber[] {
  // A fixed tilt makes the default picture more legible, then the animated rotation.
  const tilt = multiply(rotation(4, 1, 3, 0.35), rotation(4, 0, 2, 0.25));
  const rot = multiply(rotation(4, s.plane[0], s.plane[1], s.angle), tilt);
  const out: HopfFiber[] = [];
  for (const b of hopfBasePoints(s.bands, s.perBand)) {
    const circle = projectedFiber(b.theta, b.phi, rot);
    if (!circle || circle.radius > 16) continue; // fibers near the pole become huge (in the limit, lines)
    out.push({ circle, color: b.color, theta: b.theta, phi: b.phi });
  }
  return out;
}

const VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aUV;
layout(location = 1) in vec3 iCenter;
layout(location = 2) in vec3 iE1;
layout(location = 3) in vec3 iE2;
layout(location = 4) in vec4 iColorRadius;
uniform mat4 uViewProj;
uniform float uThickness;
out vec3 vNormal;
out vec3 vColor;
out vec3 vPos;
void main() {
  float u = aUV.x;
  float a = aUV.y;
  vec3 radial = cos(u) * iE1 + sin(u) * iE2;
  vec3 bin = cross(iE1, iE2);
  vec3 n = cos(a) * radial + sin(a) * bin;
  // Thicker tubes for big (far-reaching) circles keep them visible.
  float r = uThickness * (1.0 + 0.04 * iColorRadius.w);
  vec3 p = iCenter + iColorRadius.w * radial + r * n;
  vNormal = n;
  vColor = iColorRadius.rgb;
  vPos = p;
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

const FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec3 vPos;
uniform vec3 uEye;
uniform vec3 uKeyDir;
uniform vec3 uFillDir;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vPos);
  if (dot(n, v) < 0.0) n = -n;
  vec3 base = pow(vColor, vec3(2.2));
  float ndl = dot(n, uKeyDir);
  float wrap = max((ndl + 0.3) / 1.3, 0.0);
  float fill = max(dot(n, uFillDir), 0.0);
  vec3 h = normalize(uKeyDir + v);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * step(0.0, ndl);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 amb = mix(vec3(0.05, 0.055, 0.07), vec3(0.17, 0.18, 0.22), hemi);
  vec3 col = base * (amb + wrap * vec3(1.0, 0.965, 0.92) + 0.25 * fill * vec3(0.6, 0.7, 1.0));
  col += spec * 0.35 + fres * 0.12 * vec3(0.55, 0.7, 1.0);
  float dist = length(uEye - vPos);
  col = mix(col, vec3(0.02, 0.025, 0.04), clamp((dist - 9.0) / 30.0, 0.0, 0.85));
  col = col / (1.0 + col * 0.18);
  outColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
`;

const BG_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aUV;
out vec2 vUv;
void main() { vUv = aUV * 0.5 + 0.5; gl_Position = vec4(aUV, 0.999, 1.0); }
`;
const BG_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 top = vec3(0.05, 0.062, 0.09);
  vec3 bottom = vec3(0.012, 0.014, 0.022);
  vec3 c = mix(bottom, top, smoothstep(0.0, 1.0, vUv.y));
  vec2 d = vUv - 0.5;
  c *= 1.0 - dot(d, d) * 0.35;
  outColor = vec4(pow(c / (1.0 + c * 0.18), vec3(1.0 / 2.2)), 1.0);
}
`;

const COPY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() { outColor = vec4(texture(uTex, vUv).rgb, 1.0); }
`;

const SEG_U = 120;
const SEG_A = 12;

export class HopfRenderer {
  private prog: Program;
  private bg: Program;
  private copy: Program;
  private resolve: RenderTarget | null = null;
  private vao: WebGLVertexArrayObject;
  private bgVao: WebGLVertexArrayObject;
  private instanceBuf: WebGLBuffer;
  private indexCount: number;
  private fbo: WebGLFramebuffer | null = null;
  private color: WebGLRenderbuffer | null = null;
  private depth: WebGLRenderbuffer | null = null;
  private size = [0, 0];
  private samples: number;
  fiberCount = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS);
    this.bg = createProgram(gl, BG_VS, BG_FS);
    this.copy = createProgram(gl, BG_VS, COPY_FS);
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);

    // Unit tube: (u along the circle, a around the tube).
    const uv: number[] = [];
    for (let i = 0; i <= SEG_U; i++) for (let j = 0; j <= SEG_A; j++) uv.push((2 * Math.PI * i) / SEG_U, (2 * Math.PI * j) / SEG_A);
    const idx: number[] = [];
    for (let i = 0; i < SEG_U; i++)
      for (let j = 0; j < SEG_A; j++) {
        const a = i * (SEG_A + 1) + j;
        const b = a + SEG_A + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    this.indexCount = idx.length;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this.instanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    const stride = 13 * 4;
    const attr = (loc: number, size: number, offset: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 3, 0);
    attr(2, 3, 3);
    attr(3, 3, 6);
    attr(4, 4, 9);
    gl.bindVertexArray(null);

    this.bgVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.bgVao);
    const tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private ensureTarget(w: number, h: number) {
    const gl = this.gl;
    if (this.fbo && this.size[0] === w && this.size[1] === h) return;
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo);
      gl.deleteRenderbuffer(this.color);
      gl.deleteRenderbuffer(this.depth);
    }
    this.fbo = gl.createFramebuffer();
    this.color = gl.createRenderbuffer();
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new GLError('Hopf framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Multisampled buffers can only be resolved into a matching format, so resolve to an
    // RGBA8 texture and copy that to the canvas (whose format depends on context options).
    deleteTarget(gl, this.resolve);
    this.resolve = createTarget(gl, w, h, false);
    this.size = [w, h];
  }

  render(canvas: HTMLCanvasElement, camera: CameraController, settings: HopfSettings, dpr: number) {
    const gl = this.gl;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.ensureTarget(w, h);

    const fibers = hopfFibers(settings);
    this.fiberCount = fibers.length;
    const data = new Float32Array(fibers.length * 13);
    fibers.forEach((f, i) => {
      const c = f.circle;
      data.set([...c.center, ...c.e1, ...c.e2, ...f.color, c.radius], i * 13);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.bg.program);
    gl.bindVertexArray(this.bgVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const b = cameraBasis(camera.orbit);
    const aspect = w / h;
    const near = 0.05;
    const far = 200;
    const f = 1 / b.tanHalfFov;
    // View matrix rows (right, up, -forward) and perspective projection, column-major.
    const view = [
      b.right[0],
      b.up[0],
      -b.forward[0],
      0,
      b.right[1],
      b.up[1],
      -b.forward[1],
      0,
      b.right[2],
      b.up[2],
      -b.forward[2],
      0,
      -(b.right[0] * b.eye[0] + b.right[1] * b.eye[1] + b.right[2] * b.eye[2]),
      -(b.up[0] * b.eye[0] + b.up[1] * b.eye[1] + b.up[2] * b.eye[2]),
      b.forward[0] * b.eye[0] + b.forward[1] * b.eye[1] + b.forward[2] * b.eye[2],
      1,
    ];
    const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
    const vp = mul4(proj, view);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.useProgram(this.prog.program);
    gl.uniformMatrix4fv(this.prog.loc('uViewProj'), false, new Float32Array(vp));
    gl.uniform1f(this.prog.loc('uThickness'), settings.thickness);
    gl.uniform3fv(this.prog.loc('uEye'), b.eye);
    const key = norm3([
      -b.right[0] * 0.45 - b.forward[0] * 0.35,
      1 - b.forward[1] * 0.35 - b.right[1] * 0.45,
      -b.right[2] * 0.45 - b.forward[2] * 0.35,
    ]);
    gl.uniform3fv(this.prog.loc('uKeyDir'), key);
    gl.uniform3fv(this.prog.loc('uFillDir'), norm3([b.right[0] * 0.8 - b.forward[0] * 0.3, -0.25, b.right[2] * 0.8 - b.forward[2] * 0.3]));
    gl.bindVertexArray(this.vao);
    if (fibers.length) gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, fibers.length);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolve!.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.copy.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.resolve!.tex);
    gl.uniform1i(this.copy.loc('uTex'), 0);
    gl.bindVertexArray(this.bgVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.prog.program);
    gl.deleteProgram(this.bg.program);
    gl.deleteProgram(this.copy.program);
    deleteTarget(gl, this.resolve);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.color) gl.deleteRenderbuffer(this.color);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
  }
}

/** Column-major 4x4 product a * b. */
function mul4(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

function norm3(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
