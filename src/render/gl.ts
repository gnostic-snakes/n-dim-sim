/** Small WebGL2 helpers. */

export class GLError extends Error {}

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new GLError('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    const numbered = src
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(4)}: ${l}`)
      .join('\n');
    console.error(numbered);
    throw new GLError(`Shader compile error:\n${log}`);
  }
  return sh;
}

export interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
  loc(name: string): WebGLUniformLocation | null;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const p = gl.createProgram();
  if (!p) throw new GLError('createProgram failed');
  const v = compileShader(gl, gl.VERTEX_SHADER, vs);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new GLError(`Program link error:\n${gl.getProgramInfoLog(p)}`);
  }
  const uniforms = new Map<string, WebGLUniformLocation>();
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    const loc = gl.getUniformLocation(p, info.name);
    if (loc) uniforms.set(name, loc);
  }
  return { program: p, uniforms, loc: (name) => uniforms.get(name) ?? null };
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
  float: boolean;
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number, float: boolean): RenderTarget {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA, float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    if (float) return createTarget(gl, width, height, false);
    throw new GLError('Framebuffer incomplete');
  }
  return { fbo, tex, width, height, float };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: RenderTarget | null) {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/** A float texture used as a flat array of vec4s. */
export class DataTexture {
  readonly width = 256;
  private height = 0;
  private tex: WebGLTexture;
  private data = new Float32Array(0);

  constructor(private gl: WebGL2RenderingContext) {
    this.tex = gl.createTexture()!;
  }

  get texture(): WebGLTexture {
    return this.tex;
  }

  upload(values: Float32Array, texels: number) {
    const gl = this.gl;
    const rows = Math.max(1, Math.ceil(texels / this.width));
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (rows > this.height || this.data.length < rows * this.width * 4) {
      this.height = Math.max(rows, this.height * 2, 1);
      this.data = new Float32Array(this.width * this.height * 4);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.data.set(values.subarray(0, Math.min(values.length, this.data.length)));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.width, this.height, 0, gl.RGBA, gl.FLOAT, this.data);
      return;
    }
    this.data.fill(0, 0, rows * this.width * 4);
    this.data.set(values.subarray(0, Math.min(values.length, rows * this.width * 4)));
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, rows, gl.RGBA, gl.FLOAT, this.data, 0);
  }
}

export function hexToLinear(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return v.map((c) => {
    const s = (Number.isFinite(c) ? c : 200) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}
