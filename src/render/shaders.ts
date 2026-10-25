/**
 * GLSL for the slice view.
 *
 * One fragment shader traces each pixel's ray through every object:
 *  - convex polytopes are intersected analytically against their slice planes
 *    (no marching needed: entry = max over front-facing planes, exit = min over
 *    back-facing ones), which also gives crisp edges from plane-pair distances;
 *  - curved shapes are sphere-traced on their n-D distance bound, evaluated at
 *    p = L q + t0 (the slice point mapped into shape space).
 * The SDF part is generated per scene (see buildSceneShader), because each
 * curved shape is a different expression in a different dimension.
 */
import { glslHelpers, toGLSL, type Expr } from '../math/sdf';

export const MAX_PLANES = 1024;
export const MAX_POLY = 8;
export const MAX_SDF = 6;
export const META_WIDTH = 256;

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export interface SdfSlot {
  expr: Expr;
  /** Shape dimension. */
  n: number;
  params: string[];
}

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

out vec4 outColor;

uniform vec4 uViewport;
uniform vec2 uJitter;
uniform int uShading;
uniform int uEdges;
uniform int uHighlight;
uniform vec3 uBgTop;
uniform vec3 uBgBottom;

layout(std140) uniform PlaneBlock { vec4 uPlanes[${MAX_PLANES}]; };
uniform sampler2D uMeta;

uniform int uPolyCount;
uniform ivec4 uPolyInfo[${MAX_POLY}];
uniform vec4 uPolyBound[${MAX_POLY}];
uniform vec4 uPolyColor[${MAX_POLY}];
uniform vec4 uPolyDepth[${MAX_POLY}];
uniform float uPolyDepthScale[${MAX_POLY}];

vec4 planeMeta(int i) { return texelFetch(uMeta, ivec2(i % ${META_WIDTH}, i / ${META_WIDTH}), 0); }

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }

// Colour for a cell (n-D facet) index: golden-ratio hue steps.
vec3 cellColor(float id) {
  float h = fract(id * 0.61803398875 + 0.07);
  return srgbToLinear(hsv2rgb(vec3(h, 0.52, 0.93)));
}

// +hidden (towards +w) is warm orange, -hidden is cool blue, 0 is a soft neutral.
const vec3 WARM = vec3(0.98, 0.42, 0.10);
const vec3 COOL = vec3(0.10, 0.42, 0.98);
const vec3 NEUTRAL = vec3(0.80, 0.80, 0.78);
vec3 diverging(float s) {
  s = clamp(s, -1.0, 1.0);
  return s >= 0.0 ? mix(NEUTRAL, WARM, pow(s, 0.8)) : mix(NEUTRAL, COOL, pow(-s, 0.8));
}
// Hidden part of the n-D normal: hue from its direction (w: warm/cool; v rotates the hue), saturation from its size.
vec3 tiltColor(float mag, float h0, float h1) {
  float a = atan(h1, h0);
  vec3 hue = srgbToLinear(hsv2rgb(vec3(fract(0.075 - a / 6.2831853), 0.85, 0.98)));
  if (abs(h1) < 1e-4) hue = h0 >= 0.0 ? WARM : COOL;
  return mix(NEUTRAL, hue, clamp(pow(mag, 0.75), 0.0, 1.0));
}
`;

/** GLSL for each SDF slot: uniforms, shape-space expression, slice-space distance and gradient. */
function sdfSlotCode(slot: SdfSlot, s: number, k: number, helpers: Set<number>): string {
  const N = slot.n;
  const qType = k === 3 ? 'vec3' : 'vec2';
  const sw = k === 3 ? 'xyz' : 'xy';
  const P4 = Math.max(1, Math.ceil(slot.params.length / 4));
  const comp = ['x', 'y', 'z', 'w'];
  const expr = toGLSL(
    slot.expr,
    {
      coord: (i) => `p[${i}]`,
      param: (name) => {
        const j = Math.max(0, slot.params.indexOf(name));
        return `uSdfPar${s}[${j >> 2}].${comp[j & 3]}`;
      },
    },
    helpers,
  );
  return `
uniform vec4 uSdfRow${s}[${N}];
uniform vec4 uSdfHid${s}[${N}];
uniform vec4 uSdfPar${s}[${P4}];
uniform vec4 uSdfBound${s};
uniform vec4 uSdfColor${s};
uniform vec2 uSdfScale${s};

float shape${s}(float p[${N}]) { return ${expr}; }

void toShape${s}(${qType} q, out float p[${N}]) {
  for (int i = 0; i < ${N}; i++) p[i] = dot(uSdfRow${s}[i].${sw}, q) + uSdfRow${s}[i].w;
}

float sdf${s}(${qType} q) {
  float p[${N}];
  toShape${s}(q, p);
  return shape${s}(p) * uSdfScale${s}.x;
}

// World-space n-D gradient at slice point q (visible part, first four hidden components)
// and the shape-space coordinate along the first hidden axis.
void sdfGrad${s}(${qType} q, out ${qType} gVis, out vec4 gHid, out float depth) {
  float p[${N}];
  toShape${s}(q, p);
  float g[${N}];
  float h = 1e-3 * max(uSdfBound${s}.w, 0.1);
  for (int i = 0; i < ${N}; i++) {
    float o = p[i];
    p[i] = o + h; float a = shape${s}(p);
    p[i] = o - h; float b = shape${s}(p);
    p[i] = o;
    g[i] = (a - b) / (2.0 * h);
  }
  gVis = ${qType}(0.0);
  gHid = vec4(0.0);
  for (int i = 0; i < ${N}; i++) {
    gVis += g[i] * uSdfRow${s}[i].${sw};
    gHid += g[i] * uSdfHid${s}[i];
  }
  depth = p[${Math.min(k, N - 1)}] * uSdfScale${s}.y;
}
`;
}

/** Sphere tracer for slot s (3D only). */
function sdfMarchCode(s: number): string {
  return `
float gradLen${s}(vec3 p, float h) {
  const vec2 kk = vec2(1.0, -1.0);
  vec3 g = kk.xyy * sdf${s}(p + kk.xyy * h) + kk.yyx * sdf${s}(p + kk.yyx * h)
         + kk.yxy * sdf${s}(p + kk.yxy * h) + kk.xxx * sdf${s}(p + kk.xxx * h);
  return length(g) / (4.0 * h);
}

// Returns hit distance or -1. 'inside' is set if the ray starts inside the shape.
float march${s}(vec3 ro, vec3 rd, float tMax, out bool inside) {
  inside = false;
  vec4 b = uSdfBound${s};
  if (b.w <= 0.0) return -1.0;
  vec3 oc = ro - b.xyz;
  float bb = dot(oc, rd);
  float cc = dot(oc, oc) - b.w * b.w;
  float disc = bb * bb - cc;
  if (disc < 0.0) return -1.0;
  float sq = sqrt(disc);
  float t = max(-bb - sq, 0.0);
  float tEnd = min(-bb + sq, tMax);
  if (t > tEnd) return -1.0;
  float d0 = sdf${s}(ro + rd * t);
  if (d0 < 0.0) {
    // Camera inside: march to the exit surface instead.
    inside = true;
    for (int i = 0; i < 128; i++) {
      float d = -sdf${s}(ro + rd * t);
      float eps = max(t * PIXEL_ANGLE * 0.5, 1e-4);
      if (d < eps) return t;
      t += d;
      if (t > tEnd) return -1.0;
    }
    return -1.0;
  }
  float tPrev = t;
  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = sdf${s}(p);
    float eps = max(t * PIXEL_ANGLE * 0.35, 1e-4);
    if (d < 0.0) {
      // Overshot into the interior: bisect back to the surface.
      float lo = tPrev;
      float hi = t;
      for (int j = 0; j < 10; j++) {
        float mid = 0.5 * (lo + hi);
        if (sdf${s}(ro + rd * mid) < 0.0) hi = mid; else lo = mid;
      }
      return hi;
    }
    if (d < 6.0 * eps) {
      // Slices of an n-D distance bound can have a small 3D gradient; measure it so we
      // neither stop early (fat silhouettes) nor crawl.
      float g = gradLen${s}(p, max(eps, 1e-3));
      float dt = d / max(g, 0.03);
      if (dt < eps) return t;
      tPrev = t;
      t += max(d, 0.8 * dt);
    } else {
      tPrev = t;
      t += d;
    }
    if (t > tEnd) return -1.0;
  }
  return -1.0;
}
`;
}

/** The 3D slice-view fragment shader for a given set of SDF slots. */
export function buildSceneShader(slots: SdfSlot[]): string {
  const helpers = new Set<number>();
  const slotCode = slots.map((s, i) => sdfSlotCode(s, i, 3, helpers) + sdfMarchCode(i)).join('\n');
  const S = slots.length;

  const traceSdf = slots
    .map(
      (_, s) => `
  {
    bool ins;
    float t = march${s}(ro, rd, h.t, ins);
    if (t >= 0.0 && t < h.t) { h.t = t; h.kind = 2; h.slot = ${s}; h.inside = ins; }
  }`,
    )
    .join('');

  const sdfShadeCases = slots
    .map(
      (_, s) => `
    if (h.slot == ${s}) {
      sdfGrad${s}(pos, gVis, gHid, depth);
      base = uSdfColor${s}.rgb; obj = int(uSdfColor${s}.w);
    }`,
    )
    .join('');

  const sceneSdfTerms = slots.map((_, s) => `  d = min(d, sdfBounded${s}(p));`).join('\n');
  const boundedSdf = slots
    .map(
      (_, s) => `
float sdfBounded${s}(vec3 p) {
  vec4 b = uSdfBound${s};
  if (b.w <= 0.0) return 1e9;
  float db = length(p - b.xyz) - b.w;
  return db > 0.3 ? db : sdf${s}(p);
}`,
    )
    .join('');

  return `#version 300 es
#define MAX_STEPS 180
${COMMON}

uniform vec3 uEye;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uTanHalfFov;
uniform float uPixelAngle;
#define PIXEL_ANGLE uPixelAngle
uniform vec3 uKeyDir;
uniform vec3 uFillDir;
uniform int uFloor;
uniform float uFloorY;
uniform int uShadows;

${glslHelpers(helpers)}
${slotCode}
${boundedSdf}

struct Hit {
  float t;
  int kind;    // 0 none, 1 polytope, 2 sdf, 3 floor
  int slot;
  int face;    // entry plane (polytope)
  int backFace;
  float tExit;
  bool inside;
};

bool polyIntersect(int start, int count, vec3 ro, vec3 rd, out float tIn, out float tOut, out int fIn, out int fOut) {
  tIn = -1e20; tOut = 1e20; fIn = -1; fOut = -1;
  for (int i = 0; i < count; i++) {
    vec4 pl = uPlanes[start + i];
    float dn = dot(pl.xyz, rd);
    float num = pl.w - dot(pl.xyz, ro);
    if (abs(dn) < 1e-9) {
      if (num < 0.0) return false;
      continue;
    }
    float t = num / dn;
    if (dn < 0.0) {
      if (t > tIn) { tIn = t; fIn = start + i; }
    } else if (t < tOut) {
      tOut = t; fOut = start + i;
    }
    if (tIn > tOut) return false;
  }
  return tOut > 0.0 && fIn >= 0 && fOut >= 0;
}

// In-plane distance from q (on plane f) to the nearest edge of that face, and the
// in-plane unit direction in which that distance grows (for analytic anti-aliasing).
float faceEdgeDist(int start, int count, int f, vec3 q, out vec3 grad) {
  vec3 nf = uPlanes[f].xyz;
  float best = 1e20;
  int bj = -1;
  for (int i = 0; i < count; i++) {
    int j = start + i;
    if (j == f) continue;
    vec4 pl = uPlanes[j];
    float c = dot(nf, pl.xyz);
    float s2 = 1.0 - c * c;
    if (s2 < 1e-7) continue;
    float d = (pl.w - dot(pl.xyz, q)) * inversesqrt(s2);
    if (d < best) { best = d; bj = j; }
  }
  grad = vec3(0.0);
  if (bj >= 0) {
    vec3 nj = uPlanes[bj].xyz;
    grad = -normalize(nj - dot(nj, nf) * nf);
  }
  return best;
}

// Screen-space change per pixel of a function on plane n (hit at distance t along rd)
// whose in-plane gradient is g.
float planePixelRate(vec3 g, vec3 n, vec3 rd, float t) {
  float nd = dot(n, rd);
  if (abs(nd) < 1e-4) nd = nd < 0.0 ? -1e-4 : 1e-4;
  vec3 dx = uRight * uPixelAngle;
  vec3 dy = uUp * uPixelAngle;
  vec3 qx = t * (dx - rd * (dot(n, dx) / nd));
  vec3 qy = t * (dy - rd * (dot(n, dy) / nd));
  return length(vec2(dot(g, qx), dot(g, qy)));
}

float polySdf(int start, int count, vec3 p) {
  float d = -1e20;
  for (int i = 0; i < count; i++) {
    vec4 pl = uPlanes[start + i];
    d = max(d, dot(pl.xyz, p) - pl.w);
  }
  return d;
}

float sceneSdf(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < ${MAX_POLY}; i++) {
    if (i >= uPolyCount) break;
    vec4 b = uPolyBound[i];
    if (b.w <= 0.0) continue;
    float db = length(p - b.xyz) - b.w;
    d = min(d, db > 0.3 ? db : polySdf(uPolyInfo[i].x, uPolyInfo[i].y, p));
  }
${sceneSdfTerms}
  return d;
}

float softShadow(vec3 ro, vec3 rd, float tMax) {
  float res = 1.0;
  float t = 0.02;
  for (int i = 0; i < 48; i++) {
    float d = sceneSdf(ro + rd * t);
    res = min(res, 10.0 * d / t);
    if (res < 0.002) return 0.0;
    t += clamp(d, 0.03, 0.5);
    if (t > tMax) break;
  }
  return clamp(res, 0.0, 1.0);
}

Hit traceScene(vec3 ro, vec3 rd) {
  Hit h;
  h.t = 1e20; h.kind = 0; h.slot = -1; h.face = -1; h.backFace = -1; h.tExit = 0.0; h.inside = false;
  for (int i = 0; i < ${MAX_POLY}; i++) {
    if (i >= uPolyCount) break;
    vec4 b = uPolyBound[i];
    if (b.w <= 0.0) continue;
    vec3 oc = ro - b.xyz;
    float bb = dot(oc, rd);
    float disc = bb * bb - dot(oc, oc) + b.w * b.w;
    if (disc < 0.0 || -bb + sqrt(disc) < 0.0) continue;
    float tIn, tOut; int fIn, fOut;
    if (!polyIntersect(uPolyInfo[i].x, uPolyInfo[i].y, ro, rd, tIn, tOut, fIn, fOut)) continue;
    if (tIn > 0.0) {
      if (tIn < h.t) { h.t = tIn; h.kind = 1; h.slot = i; h.face = fIn; h.backFace = fOut; h.tExit = tOut; h.inside = false; }
    } else if (tOut < h.t) {
      // Camera is inside: show the far wall.
      h.t = tOut; h.kind = 1; h.slot = i; h.face = fOut; h.backFace = -1; h.tExit = tOut; h.inside = true;
    }
  }
${traceSdf}
  if (uFloor == 1 && rd.y < -1e-4) {
    float t = (uFloorY - ro.y) / rd.y;
    if (t > 0.0 && t < h.t) { h.t = t; h.kind = 3; h.slot = -1; }
  }
  return h;
}

vec3 background(vec3 rd) {
  float u = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  return mix(uBgBottom, uBgTop, smoothstep(0.0, 1.0, u));
}

vec3 lightSurface(vec3 base, vec3 n, vec3 rd, float shadow) {
  vec3 v = -rd;
  float ndl = dot(n, uKeyDir);
  float wrap = max((ndl + 0.3) / 1.3, 0.0);
  float fill = max(dot(n, uFillDir), 0.0);
  vec3 hv = normalize(uKeyDir + v);
  float spec = pow(max(dot(n, hv), 0.0), 56.0) * step(0.0, ndl);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 amb = mix(vec3(0.045, 0.05, 0.065), vec3(0.16, 0.175, 0.21), hemi);
  vec3 col = base * (amb + 1.0 * wrap * shadow * vec3(1.0, 0.965, 0.92) + 0.22 * fill * vec3(0.62, 0.72, 1.0));
  col += spec * 0.28 * shadow * vec3(1.0, 0.97, 0.93);
  col += fres * 0.14 * vec3(0.55, 0.7, 1.0);
  return col;
}

float edgeMask(float d, float fw, float widthPx) {
  return 1.0 - smoothstep(widthPx - 0.6, widthPx + 0.6, d / max(fw, 1e-6));
}

void main() {
  vec2 px = gl_FragCoord.xy - uViewport.xy + uJitter;
  vec2 ndc = px / uViewport.zw * 2.0 - 1.0;
  float aspect = uViewport.z / uViewport.w;
  vec3 rd = normalize(uFwd + uRight * (ndc.x * uTanHalfFov * aspect) + uUp * (ndc.y * uTanHalfFov));
  vec3 ro = uEye;

  Hit h = traceScene(ro, rd);
  vec3 col = background(rd);
  // Floor-grid derivatives must be taken in uniform control flow.
  float tFloor = rd.y < -1e-4 ? (uFloorY - ro.y) / rd.y : 1e4;
  vec2 g = (ro + rd * min(tFloor, 1e4)).xz;
  vec2 fw = fwidth(g);
  float edgeD = 1e9;
  float hiddenD = 1e9;
  float edgeRate = 1.0;
  float hiddenRate = 1.0;

  if (h.kind == 1 || h.kind == 2) {
    vec3 pos = ro + rd * h.t;
    vec3 n;
    vec3 base;
    int obj = -1;
    if (h.kind == 1) {
      vec4 pl = uPlanes[h.face];
      n = h.inside ? -pl.xyz : pl.xyz;
      vec4 meta = planeMeta(h.face);
      base = uPolyColor[h.slot].rgb;
      obj = int(uPolyColor[h.slot].w);
      if (uShading == 1) base = cellColor(meta.x);
      else if (uShading == 2) base = tiltColor(meta.y, meta.z, meta.w);
      else if (uShading == 3) {
        vec4 dr = uPolyDepth[h.slot];
        base = diverging((dot(dr.xyz, pos) + dr.w) * uPolyDepthScale[h.slot]);
      }
      int start = uPolyInfo[h.slot].x;
      int count = uPolyInfo[h.slot].y;
      vec3 eg;
      if ((uEdges & 1) != 0) {
        edgeD = faceEdgeDist(start, count, h.face, pos, eg);
        edgeRate = planePixelRate(eg, pl.xyz, rd, h.t);
      }
      if ((uEdges & 2) != 0 && h.backFace >= 0) {
        hiddenD = faceEdgeDist(start, count, h.backFace, ro + rd * h.tExit, eg);
        hiddenRate = planePixelRate(eg, uPlanes[h.backFace].xyz, rd, h.tExit);
      }
    } else {
      vec3 gVis; vec4 gHid; float depth;
      ${S > 0 ? sdfShadeCases : ''}
      float gl2 = dot(gVis, gVis);
      n = gl2 > 0.0 ? gVis * inversesqrt(gl2) : -rd;
      if (h.inside) n = -n;
      float total = sqrt(gl2 + dot(gHid, gHid));
      if (uShading == 2) {
        vec4 hn = total > 0.0 ? gHid / total : vec4(0.0);
        base = tiltColor(length(hn), hn.x, hn.y);
      } else if (uShading == 3) {
        base = diverging(depth);
      }
    }
    if (dot(n, rd) > 0.0) n = -n;
    float sh = 1.0;
    if (uShadows == 1) sh = mix(0.35, 1.0, softShadow(pos + n * 0.004, uKeyDir, 12.0));
    col = lightSurface(base, n, rd, sh);
    if (h.inside) col *= 0.55;
    if (uHighlight >= 0 && obj == uHighlight) col += vec3(0.02, 0.025, 0.03);
  } else if (h.kind == 3) {
    vec3 pos = ro + rd * h.t;
    float dist = length(pos - ro);
    vec2 major = abs(fract(g - 0.5) - 0.5) / max(fw, 1e-5);
    vec2 minor = abs(fract(g * 4.0 - 0.5) - 0.5) / max(fw * 4.0, 1e-5);
    float lineMajor = 1.0 - min(min(major.x, major.y), 1.0);
    float lineMinor = (1.0 - min(min(minor.x, minor.y), 1.0)) * 0.35;
    float fade = exp(-dist * 0.055) * smoothstep(60.0, 8.0, dist);
    vec3 floorCol = mix(uBgBottom * 1.25, uBgTop * 0.9, 0.25);
    float grid = max(lineMajor, lineMinor) * fade;
    vec3 c = floorCol + vec3(0.09, 0.1, 0.12) * grid;
    // world axes on the floor: x red, z blue
    float ax = 1.0 - min(abs(g.y) / max(fw.y, 1e-5) * 0.7, 1.0);
    float az = 1.0 - min(abs(g.x) / max(fw.x, 1e-5) * 0.7, 1.0);
    c = mix(c, vec3(0.55, 0.12, 0.1), ax * fade * 0.7);
    c = mix(c, vec3(0.1, 0.25, 0.6), az * fade * 0.7);
    float sh = 1.0;
    if (uShadows == 1) sh = mix(0.45, 1.0, softShadow(pos + vec3(0.0, 0.002, 0.0), uKeyDir, 14.0));
    c *= sh;
    col = mix(background(rd), c, fade * 0.95 + 0.05);
  }

  if (h.kind == 1) {
    float hm = edgeMask(hiddenD, hiddenRate, 0.8) * 0.5;
    col = mix(col, vec3(0.92, 0.95, 1.0) * 0.8, hm);
    float em = edgeMask(edgeD, edgeRate, 1.1);
    col = mix(col, vec3(0.012, 0.014, 0.02), em * 0.92);
  }
  outColor = vec4(col, 1.0);
}
`;
}

/** Flatland (2D slice) fragment shader. */
export function buildFlatShader(slots: SdfSlot[]): string {
  const helpers = new Set<number>();
  const slotCode = slots.map((s, i) => sdfSlotCode(s, i, 2, helpers)).join('\n');
  const sdfLayers = slots
    .map(
      (_, s) => `
  {
    float d = 1e9;
    vec4 b = uSdfBound${s};
    if (b.w > 0.0) d = sdf${s}(q);
    float fw = max(fwidth(d), uUnitsPerPx * 0.25);
    float fill = 1.0 - smoothstep(-fw, fw, d);
    float line = 1.0 - smoothstep(1.2 * fw, 2.4 * fw, abs(d));
    vec2 gVis; vec4 gHid; float depth = 0.0;
    vec3 base = uSdfColor${s}.rgb;
    vec3 lineCol = base * 0.35;
    if (b.w > 0.0 && (fill > 0.0 || line > 0.0)) {
      sdfGrad${s}(q, gVis, gHid, depth);
      float tot = sqrt(dot(gVis, gVis) + dot(gHid, gHid));
      if (uShading == 2) { vec4 hn = tot > 0.0 ? gHid / tot : vec4(0.0); lineCol = tiltColor(length(hn), hn.x, hn.y); base = mix(base, lineCol, 0.35); }
      else if (uShading == 3) base = diverging(depth);
    }
    col = mix(col, shadeFlat(base, d, fw), fill);
    col = mix(col, lineCol, line * 0.95);
  }`,
    )
    .join('');

  return `#version 300 es
${COMMON}

uniform vec2 uFlatCenter;
uniform float uUnitsPerPx;
uniform float uPxScale;

${glslHelpers(helpers)}
${slotCode}

vec3 shadeFlat(vec3 base, float d, float fw) {
  // Flat fill with a slight shade just inside the boundary, so the region reads as solid.
  float rim = 1.0 - smoothstep(0.0, 9.0 * fw, -d);
  return base * (0.97 - 0.12 * rim);
}

void main() {
  vec2 px = gl_FragCoord.xy - uViewport.xy + uJitter;
  vec2 q = uFlatCenter + (px - 0.5 * uViewport.zw) * uUnitsPerPx * uPxScale;

  // Graph paper.
  vec3 col = mix(uBgBottom, uBgTop, 0.35);
  vec2 fw = fwidth(q);
  vec2 major = abs(fract(q - 0.5) - 0.5) / max(fw, 1e-6);
  vec2 minor = abs(fract(q * 4.0 - 0.5) - 0.5) / max(fw * 4.0, 1e-6);
  float lm = 1.0 - min(min(major.x, major.y), 1.0);
  float ln = (1.0 - min(min(minor.x, minor.y), 1.0)) * 0.4;
  col += vec3(0.07, 0.08, 0.1) * max(lm, ln);
  float axX = 1.0 - min(abs(q.y) / max(fw.y, 1e-6) * 0.6, 1.0);
  float axY = 1.0 - min(abs(q.x) / max(fw.x, 1e-6) * 0.6, 1.0);
  col = mix(col, vec3(0.6, 0.14, 0.12), axX * 0.8);
  col = mix(col, vec3(0.16, 0.5, 0.2), axY * 0.8);

  for (int i = 0; i < ${MAX_POLY}; i++) {
    if (i >= uPolyCount) break;
    int start = uPolyInfo[i].x;
    int count = uPolyInfo[i].y;
    float d = -1e20;
    int side = -1;
    for (int j = 0; j < count; j++) {
      vec4 pl = uPlanes[start + j];
      float v = dot(pl.xy, q) - pl.w;
      if (v > d) { d = v; side = start + j; }
    }
    if (count == 0 || uPolyBound[i].w <= 0.0) d = 1e9;
    float fwd = max(fwidth(d), uUnitsPerPx * 0.25);
    float fill = 1.0 - smoothstep(-fwd, fwd, d);
    float line = 1.0 - smoothstep(1.4 * fwd, 2.6 * fwd, abs(d));
    vec3 base = uPolyColor[i].rgb;
    vec3 lineCol = base * 0.3;
    if (side >= 0) {
      vec4 meta = planeMeta(side);
      if (uShading == 1) lineCol = cellColor(meta.x);
      else if (uShading == 2) lineCol = tiltColor(meta.y, meta.z, meta.w);
      if (uShading == 3) {
        vec4 dr = uPolyDepth[i];
        base = diverging((dot(dr.xy, q) + dr.w) * uPolyDepthScale[i]);
      }
      if (uShading == 1 || uShading == 2) base = mix(base, lineCol, 0.25);
    }
    col = mix(col, shadeFlat(base, d, fwd), fill);
    col = mix(col, lineCol, line);
  }
${sdfLayers}
  outColor = vec4(col, 1.0);
}
`;
}

export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec2 uUvScale;
uniform float uFrame;
out vec4 outColor;

vec3 tonemap(vec3 c) {
  // Gentle filmic curve, then sRGB-ish gamma.
  c = c / (1.0 + c * 0.18);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = texture(uTex, uv * uUvScale).rgb;
  vec2 d = uv - 0.5;
  c *= 1.0 - dot(d, d) * 0.35;
  vec3 outc = tonemap(c);
  // Dither to avoid banding in the dark gradient.
  float n = fract(sin(dot(gl_FragCoord.xy + uFrame, vec2(12.9898, 78.233))) * 43758.5453);
  outc += (n - 0.5) / 255.0;
  outColor = vec4(outc, 1.0);
}
`;
