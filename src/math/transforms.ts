/**
 * Transform stacks: an ordered list of rotate / translate / scale operations.
 *
 * Operations are applied in list order, each one relative to the fixed world
 * axes. Applying op_1 then op_2 ... then op_k gives M = M_k ... M_2 M_1, so a
 * shape-space point p lands at world position M p.
 */
import type { Plane } from './axes';
import { singularRange } from './eigen';
import { identity, multiply, type Mat } from './mat';
import { linearPart, rotation, scaling, translation } from './homogeneous';

export type TransformOpSpec =
  | { kind: 'rotate'; plane: Plane; /** degrees */ angle: number }
  | { kind: 'translate'; axis: number; amount: number }
  | { kind: 'scale'; axis: number | 'uniform'; factor: number };

export const DEG = Math.PI / 180;

/** Smallest allowed |scale factor|, to keep matrices invertible. */
export const MIN_SCALE = 1e-3;

function safeFactor(f: number): number {
  if (!Number.isFinite(f)) return 1;
  if (Math.abs(f) < MIN_SCALE) return f < 0 ? -MIN_SCALE : MIN_SCALE;
  return f;
}

export function opIsValid(n: number, op: TransformOpSpec): boolean {
  switch (op.kind) {
    case 'rotate':
      return op.plane[0] !== op.plane[1] && op.plane.every((a) => a >= 0 && a < n);
    case 'translate':
      return op.axis >= 0 && op.axis < n;
    case 'scale':
      return op.axis === 'uniform' || (op.axis >= 0 && op.axis < n);
  }
}

export function opMatrix(n: number, op: TransformOpSpec): Mat {
  switch (op.kind) {
    case 'rotate':
      return rotation(n, op.plane[0], op.plane[1], op.angle * DEG);
    case 'translate':
      return translation(n, op.axis, op.amount);
    case 'scale':
      return scaling(n, op.axis, safeFactor(op.factor));
  }
}

/** Analytic inverse of a single op (more accurate than a numeric inverse). */
export function opInverseMatrix(n: number, op: TransformOpSpec): Mat {
  switch (op.kind) {
    case 'rotate':
      return rotation(n, op.plane[0], op.plane[1], -op.angle * DEG);
    case 'translate':
      return translation(n, op.axis, -op.amount);
    case 'scale':
      return scaling(n, op.axis, 1 / safeFactor(op.factor));
  }
}

export interface ComposedTransform {
  /** shape space -> world */
  matrix: Mat;
  /** world -> shape space */
  inverse: Mat;
}

/** Compose ops in list order: M = M_k ... M_1 and M^-1 = M_1^-1 ... M_k^-1. Invalid ops are skipped. */
export function composeStack(n: number, ops: readonly TransformOpSpec[]): ComposedTransform {
  let matrix = identity(n + 1);
  let inverse = identity(n + 1);
  for (const op of ops) {
    if (!opIsValid(n, op)) continue;
    matrix = multiply(opMatrix(n, op), matrix);
    inverse = multiply(inverse, opInverseMatrix(n, op));
  }
  return { matrix, inverse };
}

/**
 * Smallest and largest stretch factor of the transform (singular values of its
 * linear part). Used to keep distance estimates conservative under scaling.
 */
export function stretchRange(matrix: Mat): [number, number] {
  return singularRange(linearPart(matrix));
}
