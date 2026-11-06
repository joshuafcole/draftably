/**
 * `check --metrics` findings that measure how a drawing reads, beyond the conflicts `check`
 * reports by default and the notes `qualityNotes` makes from the drawing's size and routes. Each
 * one is a measured fact about the drawing, never a verdict: a finding is a warning to weigh,
 * and `check` still passes a file that has them.
 *
 * Thresholds are stated in node units, the default box (`defaultShapeSize('box')`, 164×56), so a
 * rule's sentence holds whatever the theme's type size.
 */
import type { VisibleGraph } from '../model/graph';
import type { DrawnRoute } from '../model/routes';
import { defaultShapeSize } from '../model/styles';
import type { Diagram, Rect } from '../model/types';
import type { Diagnostic, Scene } from './compile';

/** The default box's width and height: the unit every threshold here is stated in. */
export const NODE = defaultShapeSize('box');

/** A compiled scene, projected, routed and drawn as the CLI draws it. */
export interface Drawing {
  scene: Scene;
  doc: Diagram;
  vg: VisibleGraph;
  rects: Map<string, Rect>;
  routes: DrawnRoute[];
  /** The whole image's size, frame and heading included. */
  metrics: { width: number; height: number };
}

/** Every finding this module measures on a drawing, in a fixed order. */
export function drawingNotes(_d: Drawing): Diagnostic[] {
  return [];
}
