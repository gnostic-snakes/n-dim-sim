import type { Expr } from '../math/sdf';
import type { Vec } from '../math/vec';
import type { PolytopeGeometry } from './polytopes';

/** A continuous, keyframable shape parameter. */
export interface ShapeParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  hint?: string;
}

/** A structural (integer) option; changing it rebuilds the geometry and is not animatable. */
export interface ShapeOptionDef {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

export interface ShapeCount {
  label: string;
  value: number;
}

export interface ShapeInfo {
  description: string;
  funFact?: string;
  symbol?: string;
  counts?: ShapeCount[];
}

export type ShapeCategory = 'regular' | 'family' | 'prism' | 'curved' | 'flatland';

interface ShapeDefBase {
  id: string;
  category: ShapeCategory;
  /** Supported dimensions. */
  dims: (n: number) => boolean;
  name: (n: number, options: Record<string, number>) => string;
  params: ShapeParamDef[];
  options?: ShapeOptionDef[];
  info: (n: number, options: Record<string, number>) => ShapeInfo;
  /** Radius of a ball around the shape-space origin containing the shape. */
  boundingRadius: (n: number, params: Record<string, number>, options: Record<string, number>) => number;
}

export interface PolytopeShapeDef extends ShapeDefBase {
  kind: 'polytope';
  /** Unit-circumradius geometry; the `size` parameter scales it. */
  geometry: (n: number, options: Record<string, number>) => PolytopeGeometry;
}

export interface SdfShapeDef extends ShapeDefBase {
  kind: 'sdf';
  sdf: (n: number, options: Record<string, number>) => Expr;
  /** Extra values computed from params and passed to the expression (e.g. cone slopes). */
  derive?: (params: Record<string, number>) => Record<string, number>;
  /** Polylines on (or near) the surface, for the projected "ghost" wireframe. */
  wireframe: (n: number, params: Record<string, number>, options: Record<string, number>) => Vec[][];
}

export type ShapeDef = PolytopeShapeDef | SdfShapeDef;
