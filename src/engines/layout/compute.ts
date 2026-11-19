import type { Diagram, Direction } from '../../model/types.ts';
import { arrange } from './arrange.ts';
import { normalizeIntent } from './intent.ts';
import { finish } from './report.ts';
import { createScene } from './scene.ts';
import { seedHierarchy } from './seed.ts';
import { settings } from './settings.ts';
import { bilateralTarget } from './trees.ts';
import type { LayoutOptions, LayoutResult, Settings } from './types.ts';
import { copy } from './util.ts';

/**
 * Lays out a copy of `input`. A pass moves boxes at most `maxMove` from where they are; a rebuild
 * starts from a seed. Pins, fixed frames and the scope bound what may move.
 */
export async function compute(input: Diagram, opts: LayoutOptions = {}): Promise<LayoutResult> {
  const started = Date.now(),
    doc = copy(input),
    s: Settings = settings({ ...input.settings, ...opts });
  doc.layout.intent = normalizeIntent(
    doc.layout.intent || {},
    new Set(doc.graph.nodes.map(n => n.id)),
  );
  const intent = doc.layout.intent,
    authoredRootId = s.rootId;
  if (intent.start) s.rootId = intent.start.id;
  const scene = createScene(input, doc, s, opts),
    { run, compound, globalTopology, pos, groups, entities, child, parent, inheritedDirection } =
      scene,
    { branch, descend, captureTrace } = scene,
    { warnings } = run;
  const scope = opts.scope || 'all',
    selected = (opts.selected || []).filter(id => entities.has(id));
  if (!['all', 'selection', 'container', 'neighbourhood'].includes(scope))
    throw Error('Invalid layout scope.');
  captureTrace('Your arrangement', true);
  if (intent.start?.placement === 'center')
    bilateralTarget(
      doc.graph.nodes.map(n => ({ ...n, ...pos[n.id] })),
      globalTopology,
      s,
    );
  if (globalTopology.feedback.size)
    warnings.add(
      globalTopology.feedback.size +
        ' feedback edge(s) remain visible; cyclic edges cannot all follow one direction.',
    );
  if (compound && s.mode === 'rebuild' && !opts.warmStart) {
    if (scope === 'all') seedHierarchy(scene, null, s.direction);
    else if (scope === 'container') {
      const id = opts.containerId || selected.find(id => groups.has(id));
      if (groups.has(id!)) seedHierarchy(scene, id!, inheritedDirection(parent(id!)));
    }
  }
  async function walk(pid: string | null, direction: Direction) {
    if (pid && branch(pid)) return;
    const dir = doc.layout.containers[pid!]?.direction;
    const inherited = dir && dir !== 'inherit' ? dir : direction;
    if (compound && run.hierarchyPhase % 2)
      await arrange(
        scene,
        child(pid).map(n => n.id),
        pid,
        inherited,
      );
    for (const n of child(pid))
      if (groups.has(n.id) && !doc.collapsed.includes(n.id) && !branch(n.id))
        await walk(n.id, inherited);
    if (!compound || run.hierarchyPhase % 2 === 0)
      await arrange(
        scene,
        child(pid).map(n => n.id),
        pid,
        inherited,
      );
  }
  if (scope === 'all') {
    for (
      run.hierarchyPhase = 0;
      run.hierarchyPhase < (compound ? s.hierarchySweeps : 1);
      run.hierarchyPhase++
    )
      await walk(null, s.direction);
  } else if (scope === 'container') {
    const id = opts.containerId || selected.find(id => groups.has(id));
    if (!groups.has(id!)) throw Error('Select a container first.');
    for (
      run.hierarchyPhase = 0;
      run.hierarchyPhase < (compound ? s.hierarchySweeps : 1);
      run.hierarchyPhase++
    )
      await walk(id!, inheritedDirection(parent(id!)));
  } else {
    let ids = selected.filter(
      id => !selected.some(a => a !== id && groups.has(a) && descend(a).includes(id)),
    );
    if (scope === 'neighbourhood') {
      const ns = new Set(ids);
      for (const e of doc.graph.edges) {
        if (ns.has(e.from)) ids.push(e.to);
        if (ns.has(e.to)) ids.push(e.from);
      }
      ids = [...new Set(ids)];
    }
    if (!ids.length) throw Error('Select at least one object.');
    const p = parent(ids[0]) || null;
    if (ids.some(id => (parent(id) || null) !== p))
      throw Error('Select objects in one container, or use Whole diagram.');
    await arrange(scene, ids, p, inheritedDirection(p));
  }
  return finish(scene, scope, started, authoredRootId);
}
