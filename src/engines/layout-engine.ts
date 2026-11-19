/* Bounded, warm-start graph layout with checkpoint recording.
 * Original implementations; see book/references for algorithmic antecedents.
 * No engine downloads, no random initialisation during improvement passes.
 * Browser + Worker + Node compatible. The document is always cloned.
 *
 * The phases live in `layout/`: settings, topology, the targets (layered, trees, grid), the
 * solve of one container (arrange, forces, separation, packing) and the report.
 *
 * Node runs the engines with no build (the engine suites do). So an engine module imports other
 * engine modules with the `.ts` extension, and only types from outside `engines/`. A change here
 * must keep the output byte for byte: `pnpm test:engines` compares it with `reference/v7/`.
 */
import { compute } from './layout/compute.ts';
import { normalizeIntent, placements } from './layout/intent.ts';
import { ALGORITHMS, defaults, settings } from './layout/settings.ts';
import { topology } from './layout/topology.ts';

export const LayoutLab = {
  algorithms: ALGORITHMS,
  defaults,
  settings,
  compute,
  normalizeIntent,
  placements,
  topology,
};

export type {
  LayoutAlgorithm,
  LayoutMetrics,
  LayoutOptions,
  LayoutReport,
  LayoutResult,
  LayoutScope,
  LayoutSettingKey,
  SolverStop,
  Termination,
  TraceFrame,
} from './layout/types.ts';
export type { Point } from '../model/types.ts';
