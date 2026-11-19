import type { IntentPlacement, IntentRole } from '../../model/types.ts';
import type { Centres, Item, LayoutIntent } from './types.ts';
import { bounds } from './util.ts';

export type Hint = { id: string; placement: IntentPlacement };
/** The hints of an intent with their roles, in the order the intent holds them. */
export const hintsOf = (intent: LayoutIntent) =>
  Object.entries(intent) as Array<[IntentRole, Hint]>;

type RawHint = { id?: unknown; placement?: string };

/** Where in the drawing's box each placement puts a shape, as fractions of its free width and height. */
export const placements: Record<IntentPlacement, [number, number]> = {
  'top-left': [0, 0],
  'left-center': [0, 0.5],
  center: [0.5, 0.5],
  'top-center': [0.5, 0],
  'top-right': [1, 0],
  'right-center': [1, 0.5],
  'bottom-left': [0, 1],
  'bottom-center': [0.5, 1],
  'bottom-right': [1, 1],
};
/** A checked start and end hint. Throws on an unknown shape, an unknown placement, or one shape in both roles. */
export function normalizeIntent(
  raw: unknown = {},
  validIds: Set<string> | null = null,
): LayoutIntent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('Layout intent must be an object.');
  const result: LayoutIntent = {};
  for (const role of ['start', 'end'] as const) {
    const hint = (raw as Record<string, RawHint | null | undefined>)[role];
    if (hint == null) continue;
    if (!hint || typeof hint.id !== 'string' || !hint.id || (validIds && !validIds.has(hint.id)))
      throw Error('Layout ' + role + ' must reference an existing shape.');
    const placement = hint.placement || (role === 'start' ? 'top-left' : 'bottom-right');
    if (!Object.hasOwn(placements, placement)) throw Error('Invalid ' + role + ' placement.');
    result[role] = { id: hint.id, placement: placement as IntentPlacement };
  }
  if (result.start && result.start.id === result.end?.id)
    throw Error('Start and end must be different shapes.');
  return result;
}
/** The centre each hinted item should reach, inside the items' current box. */
export function hintTargets(items: Item[], intent: LayoutIntent): Centres {
  const b = bounds(items),
    by = new Map(items.map(p => [p.id, p])),
    result: Centres = new Map();
  for (const hint of Object.values(intent)) {
    const p = by.get(hint.id),
      xy = placements[hint.placement];
    if (!p || !xy) continue;
    result.set(p.id, {
      x: b.x + p.w / 2 + xy[0] * Math.max(0, b.w - p.w),
      y: b.y + p.h / 2 + xy[1] * Math.max(0, b.h - p.h),
    });
  }
  return result;
}
