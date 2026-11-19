/**
 * Compare's reading of its candidates: what each one measures, which ones are the same drawing,
 * which few are worth showing, and how each differs from the current drawing.
 */
import type { RoutingResult } from '../engines/routing-engine';
import { labelHits } from './label-hits';
import type { Rect } from './types';
import type { StaticScene } from './static-scene';

export interface Measure {
  crossings: number;
  blocked: number;
  overlaps: number;
  labels: number;
  bends: number;
  length: number;
  area: number;
  aspect: number;
}

const overlap = (a: Rect, b: Rect) =>
  a.x + 1 < b.x + b.w && b.x + 1 < a.x + a.w && a.y + 1 < b.y + b.h && b.y + 1 < a.y + a.h;

/** Pairs of objects in the same parent that overlap, drawn as nothing else can report them. */
function overlaps(scene: StaticScene) {
  const byParent = new Map<string, Rect[]>();
  for (const o of [...scene.vg.nodes, ...scene.vg.groups]) {
    const r = scene.rects.get(o.id),
      key = o.parentId ?? '';
    if (r) byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  let count = 0;
  for (const rects of byParent.values())
    rects.forEach((a, i) => (count += rects.slice(i + 1).filter(b => overlap(a, b)).length));
  return count;
}

export function measure(scene: StaticScene, routing: RoutingResult): Measure {
  const r = routing.report;
  return {
    crossings: r.crossings,
    blocked: r.blocked,
    overlaps: overlaps(scene),
    labels: labelHits(scene).length,
    bends: r.bends,
    length: r.length,
    area: scene.bounds.w * scene.bounds.h,
    aspect: scene.bounds.w / Math.max(1, scene.bounds.h),
  };
}

const TOLERANCE = 2;

/** Two drawings match when every box and line agrees within a couple of pixels. */
export function sameDrawing(a: StaticScene, b: StaticScene) {
  if (a.rects.size !== b.rects.size || a.routes.length !== b.routes.length) return false;
  const near = (x: number, y: number) => Math.abs(x - y) <= TOLERANCE;
  for (const [id, r] of a.rects) {
    const o = b.rects.get(id);
    if (!o) return false;
    if (
      !near(r.x - a.bounds.x, o.x - b.bounds.x) ||
      !near(r.y - a.bounds.y, o.y - b.bounds.y) ||
      !near(r.w, o.w) ||
      !near(r.h, o.h)
    )
      return false;
  }
  const lines = new Map(b.routes.map(route => [route.id, route.points]));
  return a.routes.every(route => {
    const points = lines.get(route.id);
    return (
      points?.length === route.points.length &&
      route.points.every(
        (p, i) =>
          near(p.x - a.bounds.x, points[i].x - b.bounds.x) &&
          near(p.y - a.bounds.y, points[i].y - b.bounds.y),
      )
    );
  });
}

export interface Reading {
  /** Hard defects this candidate has that the current drawing does not. */
  defects: string[];
  gains: string[];
  costs: string[];
}

export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** A change in percent, when it is large enough to see. */
const percent = (now: number, base: number) => {
  const change = Math.round((now / Math.max(1, base) - 1) * 100);
  return Math.abs(change) >= 5 ? change : 0;
};

/** How a candidate differs from the current drawing, from its measures alone. */
export function readDifference(m: Measure, base: Measure): Reading {
  const reading: Reading = { defects: [], gains: [], costs: [] };
  const fewer = (diff: number, noun: string) => {
    if (diff < 0) reading.gains.push(`${-diff} fewer ${noun}${diff === -1 ? '' : 's'}`);
    if (diff > 0) reading.costs.push(`${diff} more ${noun}${diff === 1 ? '' : 's'}`);
  };
  const defect = (now: number, before: number, noun: string) => {
    if (now > before) reading.defects.push(count(now - before, noun));
    if (now < before)
      reading.gains.push(`${before - now} fewer ${noun}${before - now === 1 ? '' : 's'}`);
  };
  defect(m.blocked, base.blocked, 'blocked line');
  defect(m.overlaps, base.overlaps, 'overlap');
  defect(m.labels, base.labels, 'label collision');
  fewer(m.crossings - base.crossings, 'crossing');
  const area = percent(m.area, base.area),
    length = percent(m.length, base.length);
  if (area < 0) reading.gains.push(`${-area}% smaller`);
  if (area > 0) reading.costs.push(`${area}% larger`);
  if (length < 0) reading.gains.push(`${-length}% shorter lines`);
  if (length > 0) reading.costs.push(`${length}% longer lines`);
  fewer(m.bends - base.bends, 'bend');
  return reading;
}

/** The measures of the drawing the others are read against. */
export const describeMeasure = (m: Measure) =>
  [
    count(m.crossings, 'crossing'),
    count(m.bends, 'bend'),
    ...(m.blocked ? [count(m.blocked, 'blocked line')] : []),
    ...(m.overlaps ? [count(m.overlaps, 'overlap')] : []),
    ...(m.labels ? [count(m.labels, 'label collision')] : []),
  ].join(' · ');

export interface Candidate {
  index: number;
  measure: Measure;
  scene: StaticScene;
}

/**
 * The sheet's slots after a change: each card in `keep` stays where it was, so a card never moves
 * under the pointer, and `fill` takes the free slots in order.
 */
export function holdSlots(before: number[], keep: number[], fill: number[], limit: number) {
  const coming = fill.filter(i => !keep.includes(i)),
    slots = before.flatMap(i => {
      if (keep.includes(i)) return [i];
      const next = coming.shift();
      return next === undefined ? [] : [next];
    });
  const rest = keep.filter(i => !slots.includes(i));
  return [...slots, ...rest, ...coming].slice(0, limit);
}

/** How far apart two drawings are: the mean distance between their boxes, in drawn pixels. */
function distance(a: StaticScene, b: StaticScene) {
  let sum = 0;
  for (const [id, r] of a.rects) {
    const o = b.rects.get(id);
    if (o)
      sum += Math.hypot(r.x - a.bounds.x - o.x + b.bounds.x, r.y - a.bounds.y - o.y + b.bounds.y);
  }
  return sum / Math.max(1, a.rects.size);
}

const hard = (m: Measure) => m.blocked + m.overlaps + m.labels;

/**
 * The candidates worth showing beside the current drawing, best first. Repeats of the current
 * drawing or of each other are dropped. A candidate with more hard defects than the current
 * drawing comes last, whatever its other measures, and the fewer it has the sooner it comes. A
 * candidate that beats the current drawing on something comes before one that does not: first the
 * best for hard defects, crossings, area and line length, then the ones with the fewest hard
 * defects and least like those already chosen.
 */
export function pickCandidates(current: Candidate, candidates: Candidate[], limit: number) {
  const distinct: Candidate[] = [];
  for (const c of candidates)
    if (![current, ...distinct].some(o => sameDrawing(c.scene, o.scene))) distinct.push(c);
  const sound = distinct.filter(c => hard(c.measure) <= hard(current.measure)),
    flawed = distinct.filter(c => hard(c.measure) > hard(current.measure));
  const gains = (c: Candidate) => readDifference(c.measure, current.measure).gains.length > 0;
  const picked: Candidate[] = [];
  const objectives: Array<(m: Measure) => number> = [
    hard,
    m => m.crossings,
    m => m.area,
    m => m.length,
  ];
  for (const objective of objectives) {
    const best = sound
      .filter(c => !picked.includes(c) && objective(c.measure) < objective(current.measure))
      .sort(
        (a, b) =>
          objective(a.measure) - objective(b.measure) ||
          hard(a.measure) - hard(b.measure) ||
          a.measure.bends - b.measure.bends,
      )[0];
    if (best) picked.push(best);
  }
  const unlike = (c: Candidate) =>
    Math.min(...[current, ...picked].map(o => distance(c.scene, o.scene)));
  const fill = (pool: Candidate[]) => {
    while (pool.some(c => !picked.includes(c))) {
      const rest = pool.filter(c => !picked.includes(c));
      const defects = Math.min(...rest.map(c => hard(c.measure)));
      picked.push(
        rest
          .filter(c => hard(c.measure) === defects)
          .reduce((a, b) => (unlike(b) > unlike(a) ? b : a)),
      );
    }
  };
  fill(sound.filter(gains));
  fill(sound);
  const ranked = [...picked, ...flawed.sort((a, b) => hard(a.measure) - hard(b.measure))];
  return {
    shown: ranked.slice(0, limit).map(c => c.index),
    others: ranked.slice(limit).map(c => c.index),
    alike: candidates.length - distinct.length,
  };
}
