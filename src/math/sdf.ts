/**
 * A tiny expression language for n-D signed distance functions.
 *
 * Each curved shape is written once as an expression tree, then compiled both
 * to a JavaScript closure (for tests, bounds and CPU-side queries) and to GLSL
 * (for the raymarcher), so the two can never drift apart.
 *
 * All building blocks (length, abs, min, max, subtracting constants) are
 * 1-Lipschitz, so every expression is a valid conservative distance bound.
 */
export type Expr =
  | { op: 'const'; value: number }
  | { op: 'coord'; index: number }
  | { op: 'param'; name: string }
  | { op: 'length'; args: Expr[] }
  | { op: 'max'; args: Expr[] }
  | { op: 'min'; args: Expr[] }
  | { op: 'add'; a: Expr; b: Expr }
  | { op: 'sub'; a: Expr; b: Expr }
  | { op: 'mul'; a: Expr; b: Expr }
  | { op: 'abs'; a: Expr };

type Arg = Expr | number;
const wrap = (e: Arg): Expr => (typeof e === 'number' ? { op: 'const', value: e } : e);

export const E = {
  c: (value: number): Expr => ({ op: 'const', value }),
  x: (index: number): Expr => ({ op: 'coord', index }),
  /** Coordinates i0..i1-1 as a list. */
  xs: (from: number, to: number): Expr[] => Array.from({ length: to - from }, (_, i) => E.x(from + i)),
  p: (name: string): Expr => ({ op: 'param', name }),
  len: (...args: Arg[]): Expr => ({ op: 'length', args: args.map(wrap) }),
  max: (...args: Arg[]): Expr => ({ op: 'max', args: args.map(wrap) }),
  min: (...args: Arg[]): Expr => ({ op: 'min', args: args.map(wrap) }),
  add: (a: Arg, b: Arg): Expr => ({ op: 'add', a: wrap(a), b: wrap(b) }),
  sub: (a: Arg, b: Arg): Expr => ({ op: 'sub', a: wrap(a), b: wrap(b) }),
  mul: (a: Arg, b: Arg): Expr => ({ op: 'mul', a: wrap(a), b: wrap(b) }),
  abs: (a: Arg): Expr => ({ op: 'abs', a: wrap(a) }),
};

export type CompiledSdf = (p: ArrayLike<number>, params: Record<string, number>) => number;

export function compileJS(expr: Expr): CompiledSdf {
  const build = (e: Expr): ((p: ArrayLike<number>, q: Record<string, number>) => number) => {
    switch (e.op) {
      case 'const': {
        const v = e.value;
        return () => v;
      }
      case 'coord': {
        const i = e.index;
        return (p) => p[i];
      }
      case 'param': {
        const name = e.name;
        return (_p, q) => q[name] ?? 0;
      }
      case 'length': {
        const fs = e.args.map(build);
        return (p, q) => {
          let s = 0;
          for (const f of fs) {
            const v = f(p, q);
            s += v * v;
          }
          return Math.sqrt(s);
        };
      }
      case 'max': {
        const fs = e.args.map(build);
        return (p, q) => {
          let m = -Infinity;
          for (const f of fs) m = Math.max(m, f(p, q));
          return m;
        };
      }
      case 'min': {
        const fs = e.args.map(build);
        return (p, q) => {
          let m = Infinity;
          for (const f of fs) m = Math.min(m, f(p, q));
          return m;
        };
      }
      case 'add': {
        const a = build(e.a);
        const b = build(e.b);
        return (p, q) => a(p, q) + b(p, q);
      }
      case 'sub': {
        const a = build(e.a);
        const b = build(e.b);
        return (p, q) => a(p, q) - b(p, q);
      }
      case 'mul': {
        const a = build(e.a);
        const b = build(e.b);
        return (p, q) => a(p, q) * b(p, q);
      }
      case 'abs': {
        const a = build(e.a);
        return (p, q) => Math.abs(a(p, q));
      }
    }
  };
  return build(expr);
}

/** Names of all parameters referenced by an expression, in first-use order. */
export function exprParams(expr: Expr): string[] {
  const out: string[] = [];
  const walk = (e: Expr) => {
    switch (e.op) {
      case 'param':
        if (!out.includes(e.name)) out.push(e.name);
        return;
      case 'length':
      case 'max':
      case 'min':
        e.args.forEach(walk);
        return;
      case 'add':
      case 'sub':
      case 'mul':
        walk(e.a);
        walk(e.b);
        return;
      case 'abs':
        walk(e.a);
        return;
      default:
        return;
    }
  };
  walk(expr);
  return out;
}

function glslFloat(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '1e30' : '-1e30';
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

export interface GlslOptions {
  /** GLSL expression for coordinate i, e.g. i => `p[${i}]`. */
  coord: (i: number) => string;
  /** GLSL expression for a named parameter. */
  param: (name: string) => string;
}

/**
 * GLSL source for the expression. Lengths of more than 4 terms call helper
 * functions `slen<N>` which `glslHelpers` declares.
 */
export function toGLSL(expr: Expr, opts: GlslOptions, helperArities: Set<number> = new Set()): string {
  const g = (e: Expr): string => {
    switch (e.op) {
      case 'const':
        return glslFloat(e.value);
      case 'coord':
        return opts.coord(e.index);
      case 'param':
        return opts.param(e.name);
      case 'length': {
        const parts = e.args.map(g);
        if (parts.length === 1) return `abs(${parts[0]})`;
        if (parts.length <= 4) return `length(vec${parts.length}(${parts.join(', ')}))`;
        helperArities.add(parts.length);
        return `slen${parts.length}(${parts.join(', ')})`;
      }
      case 'max':
      case 'min': {
        const parts = e.args.map(g);
        if (parts.length === 1) return parts[0];
        return parts.reduceRight((acc, cur) => `${e.op}(${cur}, ${acc})`);
      }
      case 'add':
        return `(${g(e.a)} + ${g(e.b)})`;
      case 'sub':
        return `(${g(e.a)} - ${g(e.b)})`;
      case 'mul':
        return `(${g(e.a)} * ${g(e.b)})`;
      case 'abs':
        return `abs(${g(e.a)})`;
    }
  };
  return g(expr);
}

export function glslHelpers(arities: Set<number>): string {
  return [...arities]
    .sort((a, b) => a - b)
    .map((n) => {
      const args = Array.from({ length: n }, (_, i) => `float a${i}`).join(', ');
      const sum = Array.from({ length: n }, (_, i) => `a${i}*a${i}`).join(' + ');
      return `float slen${n}(${args}) { return sqrt(${sum}); }`;
    })
    .join('\n');
}
