import { renderSvg as render, validate as check } from './render';
import type { RenderOptions, RenderResult, ValidateOptions, ValidationResult } from './types';

// Explicit signatures keep private compiler types out of the published declaration graph.
export const renderSvg: (source: string, options?: RenderOptions) => Promise<RenderResult> = render;
export const validate: (source: string, options?: ValidateOptions) => Promise<ValidationResult> =
  check;
export { runtimeVersion, fontMetricsVersion } from './version';
export type { Box, EdgeOut, Geometry, PlacedBox } from './geometry';
export type {
  CompileLimits,
  CommonRenderOptions,
  Diagnostic,
  DiagramSummary,
  ItemSummary,
  LinkPolicy,
  RenderFailure,
  RenderLimits,
  RenderOptions,
  RenderResult,
  RenderedDiagram,
  Severity,
  SourceLocation,
  ValidateOptions,
  ValidationResult,
} from './types';
