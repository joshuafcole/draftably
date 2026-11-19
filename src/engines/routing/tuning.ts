/* Costs and limits the router weighs sides, fans, detours and repairs with. */
import type { Flow, Side } from './types.ts';

export const AXIS_PENALTY = 100,
  TRAILING: Record<Flow, Side> = { right: 'right', down: 'bottom' },
  LEADING: Record<Flow, Side> = { right: 'left', down: 'top' },
  // Sides that read backwards along a direction: out of a box's left or top, into its right or
  // bottom (going right). They cost `BACK_PENALTY`, a last resort when no forward route exists.
  BACK_PENALTY = 300,
  BACK_OUT: Record<Flow, Side[]> = { right: ['left', 'top'], down: ['top', 'left'] },
  BACK_IN: Record<Flow, Side[]> = { right: ['right', 'bottom'], down: ['bottom', 'right'] };
export const HOOK_PENALTY = 80;
// Side conventions without a declared direction, and the price of a far side's loop per unit.
export const ARRIVE_BELOW = 40,
  ARRIVE_RIGHT = 12,
  LEAVE_BACK = 12,
  DETOUR_WEIGHT = 0.5,
  // Per unit of a line's run inside a container that holds only one of its ends.
  LINGER_WEIGHT = 0.3,
  BOUND_SLACK = 1;
// Fan siblings this far apart or more read as separate lines (the audit's `edges-too-close` is < 10).
export const FAN_PITCH = 10;
// A detour round a group's title band longer than this many times the crossing route.
export const DETOUR_RATIO = 1.75,
  // A gated route from a set side this many times the gap between its boxes weighs crossing.
  DETOUR_SOFT = 1.2,
  // What crossing a title band away from a top member's terminal line costs a route.
  BAND_COST = 120;
export const PORT_SLACK = 4;
export const FAR_PENALTY = 100,
  OWN_STANDOFF = 1;
// Crossing pairs the repair pass tries before it stops, to bound its time on busy drawings. Each
// try routes up to four lines again (most of the router's time on a 30-box file). Across the
// quality corpus, held-out set and examples every repair that was kept came within the first four
// tries; later ones only cost time.
export const MAX_REPAIRS = 4,
  // Lines a fan-order repair routes again at most: the crossing pair and the lines beside them.
  FAN_GROUP = 4,
  // Repairs reroute each pair against the whole drawing, so their cost grows with its size while
  // one crossing matters less. On larger drawings they rarely find a better pair: none did on the
  // graph harness's DAGs. Hand-drawn diagrams stay well below this.
  REPAIR_EDGES = 32;
