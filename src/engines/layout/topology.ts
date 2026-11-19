import type { LayoutIntent, Link, Settings, Topology } from './types.ts';
import { cmp } from './util.ts';

/**
 * The link structure of one solve: neighbours, feedback links, longest-path ranks and connected
 * parts. Links stay as given; a feedback link is only left out of the ranks.
 */
export function topology<E extends Link>(
  items: Array<{ id: string }>,
  edges: E[],
  intent: LayoutIntent = {},
): Topology<E> {
  const ids = items.map(n => n.id).sort(cmp),
    index = new Map(ids.map((id, i) => [id, i]));
  const out = new Map<string, string[]>(ids.map(id => [id, []])),
    inc = new Map<string, string[]>(ids.map(id => [id, []])),
    adj = new Map<string, string[]>(ids.map(id => [id, []]));
  const es = edges
    .filter(e => e.from !== e.to && index.has(e.from) && index.has(e.to))
    .sort((a, b) => cmp(a.from + '\0' + a.to, b.from + '\0' + b.to));
  for (const e of es) {
    if (e.directed !== false) {
      out.get(e.from)!.push(e.to);
      inc.get(e.to)!.push(e.from);
    }
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  for (const m of [out, inc, adj])
    for (const [id, list] of m) m.set(id, [...new Set(list)].sort(cmp));
  const color = new Map<string, number>(),
    feedback = new Set<string>();
  // Authored start/end decide which directions are feedback; edges are not
  // deleted, reversed, or rewritten in the document.
  for (const e of es)
    if (e.directed !== false && (e.to === intent.start?.id || e.from === intent.end?.id))
      feedback.add(e.from + '\0' + e.to);
  function visit(id: string) {
    color.set(id, 1);
    for (const to of out.get(id)!) {
      if (feedback.has(id + '\0' + to)) continue;
      if (color.get(to) === 1) feedback.add(id + '\0' + to);
      else if (!color.has(to)) visit(to);
    }
    color.set(id, 2);
  }
  [
    ...(intent.start && index.has(intent.start.id) ? [intent.start.id] : []),
    ...ids.filter(id => !inc.get(id)!.length),
    ...ids.filter(id => id !== intent.end?.id),
    ...ids,
  ].forEach(id => {
    if (!color.has(id)) visit(id);
  });
  const rank = new Map<string, number>();
  function rankOf(id: string): number {
    if (rank.has(id)) return rank.get(id)!;
    let r = 0;
    for (const from of inc.get(id)!)
      if (!feedback.has(from + '\0' + id)) r = Math.max(r, rankOf(from) + 1);
    rank.set(id, r);
    return r;
  }
  ids.forEach(rankOf);
  if (intent.end && index.has(intent.end.id)) rank.set(intent.end.id, Math.max(...rank.values()));
  const components: string[][] = [],
    seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    const part: string[] = [],
      q = [id];
    seen.add(id);
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      part.push(a);
      for (const b of adj.get(a)!)
        if (!seen.has(b)) {
          seen.add(b);
          q.push(b);
        }
    }
    components.push(part);
  }
  return {
    intent,
    ids,
    index,
    out,
    inc,
    adj,
    rank,
    feedback,
    edges: es,
    forward: es.filter(e => e.directed !== false && !feedback.has(e.from + '\0' + e.to)),
    components,
  };
}
/** Hop counts between every pair of items that links join. */
export function shortestPaths(t: Topology) {
  const distances = new Map<string, Map<string, number>>();
  for (const id of t.ids) {
    const d = new Map([[id, 0]]),
      q = [id];
    for (let i = 0; i < q.length; i++)
      for (const v of t.adj.get(q[i])!)
        if (!d.has(v)) {
          d.set(v, d.get(q[i])! + 1);
          q.push(v);
        }
    distances.set(id, d);
  }
  return distances;
}
export interface Forest {
  roots: string[];
  parent: Map<string, string>;
  kids: Map<string, string[]>;
  depth: Map<string, number>;
}
/** A breadth-first spanning forest: from the chosen root, then every source, then the rest. */
export function forest(t: Topology, s: Settings): Forest {
  const roots: string[] = [],
    parent = new Map<string, string>(),
    kids = new Map<string, string[]>(t.ids.map(id => [id, []])),
    depth = new Map<string, number>(),
    seen = new Set<string>();
  const starts = [
    ...(t.index.has(s.rootId) ? [s.rootId] : []),
    ...t.ids.filter(id => !t.inc.get(id)!.length),
    ...t.ids,
  ];
  for (const root of starts) {
    if (seen.has(root)) continue;
    roots.push(root);
    seen.add(root);
    depth.set(root, 0);
    const q = [root];
    for (let i = 0; i < q.length; i++)
      for (const id of (s.algorithm === 'radial' ? t.adj : t.out).get(q[i])!)
        if (!t.feedback.has(q[i] + '\0' + id) && !seen.has(id)) {
          seen.add(id);
          parent.set(id, q[i]);
          kids.get(q[i])!.push(id);
          depth.set(id, depth.get(q[i])! + 1);
          q.push(id);
        }
  }
  return { roots, parent, kids, depth };
}
