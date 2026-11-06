/**
 * `check --metrics --score`: one number per drawing, for ranking several. It ranks; it does not
 * judge. There is no pass mark, every finding stays a warning to weigh, and `check` still passes
 * a file with any score.
 *
 * Each finding costs what it hides from a reader, in four tiers: a word or a part of the picture
 * lost (10), a relation or a word harder to place (3), a line harder to follow (2), and the rest,
 * which is how the drawing looks (1). The tiers close on each other on purpose. `frame-sprawl`
 * counts as an issue and adds its own cost, 2 points per unit of footprint past the knee. Notes
 * that are advice about the source rather than measures of the drawing (`heading-prose`,
 * `relaxed`, `legend-missing` …) cost nothing.
 *
 * The score is the weighted sum over the drawing's size, its nodes, groups and edges (at least
 * {@link SIZE_FLOOR}), so a large drawing does not rank worse merely for being large.
 *
 * The tiers and the size floor are Callsheet's audit's, each code given the weight of the
 * Callsheet kind it measures.
 */
import type { Diagnostic } from './compile';
import { footprint, sprawlCost } from './frame-sprawl';
import type { Drawing } from './metrics';

/** What each finding costs, by code. A code not listed costs nothing. */
export const WEIGHTS: Readonly<Record<string, number>> = {
  // A word or a part of the picture is lost.
  'node-overlap': 10,
  'edge-through-node': 10,
  'edge-through-title': 10,
  'label-collision': 10,
  'outside-group': 10,
  // A relation or a word is harder to place.
  'label-detached': 3,
  'note-overlap': 3,
  'backward-side': 3,
  'faces-away': 3,
  'arrow-room': 3,
  'route-blocked': 3,
  // A line is harder to follow.
  crossing: 2,
  detour: 2,
  // How the drawing looks.
  'label-crowded': 1,
  'label-overflows-run': 1,
  stranded: 1,
  aspect: 1,
  // One issue; its cost is the sprawl past the knee.
  'frame-sprawl': 0,
};

/** The weight that marks a finding as one that loses a word or a part of the picture. */
const LOST = 10;
/** The smallest size the weighted sum is divided by. */
export const SIZE_FLOOR = 8;

export interface DrawingScore {
  /** `raw / size`: higher ranks first. */
  score: number;
  /** The weighted sum of the findings, with {@link sprawl}. */
  raw: number;
  /** Nodes, groups and edges, at least {@link SIZE_FLOOR}. */
  size: number;
  /** What `frame-sprawl` adds, 0 at or under the knee. */
  sprawl: number;
  /** How many findings carry a weight. */
  issues: number;
  /** How many of those lose a word or a part of the picture. */
  lost: number;
  /** Findings by code, for the codes that carry a weight. */
  counts: Record<string, number>;
}

/** Score a drawing's findings: the diagnostics `checkScene` reports for it with `metrics`. */
export function drawingScore(findings: Diagnostic[], d: Drawing): DrawingScore {
  const counts: Record<string, number> = {};
  let raw = 0,
    lost = 0,
    issues = 0;
  for (const f of findings) {
    const w = WEIGHTS[f.code];
    if (w === undefined || f.level === 'info') continue;
    counts[f.code] = (counts[f.code] ?? 0) + 1;
    raw += w;
    issues++;
    if (w === LOST) lost++;
  }
  const sprawl = counts['frame-sprawl'] ? sprawlCost(footprint(d)) : 0,
    size = Math.max(d.scene.objects.length + d.scene.edges.length, SIZE_FLOOR);
  raw += sprawl;
  return { score: raw / size, raw, size, sprawl, issues, lost, counts };
}
