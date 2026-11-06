/**
 * What `check` reports for a compiled scene, as one call: the scene's own diagnostics, the
 * drawing conflicts, and with `metrics` the notes on how the drawing reads. `check` and
 * `inspect --json --metrics` print this, and a host that compiles a source itself gets the same
 * findings from it.
 */
import { drawScene, qualityNotes, type Metrics } from '../cli/variants';
import type { Diagnostic, Scene } from './compile';
import { sceneConflicts } from './conflicts';
import { drawingNotes } from './metrics';
import type { Fit } from './syntax';

export interface CheckOptions {
  /** Also measure the drawing, as `check --metrics` does. */
  metrics?: boolean;
  /** The image shape `aspect` holds the drawing to, as `--fit` does. */
  fit?: Fit;
  /** Notes to list after the scene's own, such as the CLI's link notes. */
  notes?: Diagnostic[];
}

export interface CheckResult {
  diagnostics: Diagnostic[];
  /** What `vary` measures, with `warnings` counting every warning above. Set with `metrics`. */
  metrics?: Omit<Metrics, 'moved'>;
}

/**
 * Check a compiled scene. The drawing is measured only when the scene has no errors, as `check`
 * does, so `metrics` is unset for a scene with errors.
 */
export function checkScene(scene: Scene, options: CheckOptions = {}): CheckResult {
  const diagnostics = [...scene.diagnostics, ...(options.notes ?? []), ...sceneConflicts(scene)];
  if (!options.metrics || diagnostics.some(d => d.level === 'error')) return { diagnostics };
  const drawn = drawScene(scene);
  diagnostics.push(...qualityNotes(drawn, options.fit), ...drawingNotes(drawn));
  return {
    diagnostics,
    metrics: { ...drawn.metrics, warnings: diagnostics.filter(d => d.level === 'warning').length },
  };
}
