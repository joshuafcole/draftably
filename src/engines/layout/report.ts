import type { Scene } from './scene.ts';
import { hintsOf, hintTargets } from './intent.ts';
import { ALGORITHMS, defaults } from './settings.ts';
import { forwardSign } from './trees.ts';
import type { LayoutAlgorithmId } from '../../model/types.ts';
import type { LayoutReport, LayoutResult, LayoutScope } from './types.ts';
import { copy, magnitude, midpoint } from './util.ts';

/**
 * Ends a run: holds each move to the pass limit and rounds it, rejects a pass that added
 * overlaps, writes the settings back, and builds the report.
 */
export function finish(
  scene: Scene,
  scope: LayoutScope,
  started: number,
  authoredRootId: string,
): LayoutResult {
  const {
      doc,
      original,
      s,
      opts,
      run,
      intent,
      globalTopology,
      entities,
      pos,
      child,
      parent,
      inheritedDirection,
      fixed,
      visible,
      metrics,
      before,
      trace,
      captureTrace,
    } = scene,
    { warnings, stops } = run;
  // Round only after enforcing the movement disc, with an inward margin.
  let moved = 0,
    maxDisplacement = 0,
    sum2 = 0;
  for (const [id, p] of Object.entries(pos)) {
    const o = original[id];
    if (!o) continue;
    if (fixed(id) || (p.x === o.x && p.y === o.y)) {
      p.x = o.x;
      p.y = o.y;
      continue;
    }
    const dx = p.x - o.x,
      dy = p.y - o.y;
    let n = magnitude(dx, dy);
    if (s.mode === 'pass' && n > s.maxMove - 0.002 && n > 0) {
      const k = Math.max(0, s.maxMove - 0.002) / n;
      p.x = o.x + dx * k;
      p.y = o.y + dy * k;
    }
    p.x = Math.round(p.x * 1000) / 1000;
    p.y = Math.round(p.y * 1000) / 1000;
    n = magnitude(p.x - o.x, p.y - o.y);
    if (n > 0.01) {
      moved++;
      sum2 += n * n;
      maxDisplacement = Math.max(maxDisplacement, n);
    }
  }
  for (const n of entities.values())
    if (parent(n.id) && visible(n.id)) {
      const p = pos[n.id],
        frame = pos[parent(n.id)!],
        pad = doc.layout.containers[parent(n.id)!]?.padding || 24;
      if (
        p.x < frame.x + pad - 0.01 ||
        p.y < frame.y + pad + 28 - 0.01 ||
        p.x + p.w > frame.x + frame.w - pad + 0.01 ||
        p.y + p.h > frame.y + frame.h - pad + 0.01
      )
        warnings.add(
          'Some children extend beyond a frame. Enlarge that container or relax its constraints.',
        );
    }
  const after = metrics();
  if (after.overlaps > before.overlaps && s.mode === 'pass') {
    // Last-resort cross-level guard: sibling scopes can interact through frames.
    for (const id of Object.keys(pos)) pos[id] = copy(original[id]);
    warnings.add(
      'This pass was rejected because it introduced overlaps. Try a smaller scope or a different approach.',
    );
    moved = 0;
    maxDisplacement = 0;
    sum2 = 0;
  }
  const saved = doc.settings as unknown as Record<string, unknown>,
    used = s as unknown as Record<string, unknown>;
  for (const key of Object.keys(defaults)) if (!['mode'].includes(key)) saved[key] = used[key];
  doc.settings.rootId = authoredRootId;
  let backwardEdges = 0,
    directedEdges = 0;
  for (const e of globalTopology.forward) {
    const a = pos[e.from],
      b = pos[e.to];
    if (!a || !b) continue;
    directedEdges++;
    const targetAncestors = new Set();
    for (let p = parent(e.to); p; p = parent(p)) targetAncestors.add(p);
    let common = null;
    for (let p = parent(e.from); p; p = parent(p))
      if (targetAncestors.has(p)) {
        common = p;
        break;
      }
    // Cross-boundary arrows use the lowest common container's direction,
    // not an inner direction that only governs one endpoint's siblings.
    const axis = inheritedDirection(common) === 'DOWN' ? 'y' : 'x';
    const sign = forwardSign(globalTopology, e);
    if (sign && (midpoint(b)[axis] - midpoint(a)[axis]) * sign <= 0.01) backwardEdges++;
  }
  if (s.respectDirection && backwardEdges)
    warnings.add(
      backwardEdges +
        ' forward-order conflict(s) remain; pins, frames, hierarchy directions or the movement budget can constrain placement.',
    );
  const intentReport = hintsOf(intent).map(([role, hint]) => {
    const items = child(parent(hint.id)).map(n => ({ id: n.id, ...pos[n.id] })),
      q = hintTargets(items, { [role]: hint }).get(hint.id),
      p = midpoint(pos[hint.id]),
      error = q ? magnitude(p.x - q.x, p.y - q.y) : 0;
    return {
      role,
      ...hint,
      error: +error.toFixed(1),
      satisfied: error <= Math.max(12, s.nodeGap),
      pinned: fixed(hint.id),
    };
  });
  if (intentReport.some(h => !h.satisfied))
    warnings.add(
      'Some placement preferences remain approximate. They never override pins, fixed frames, collision safety, scope, or a pass movement limit.',
    );
  const report: LayoutReport = {
    intent: intentReport,
    backwardEdges,
    directedEdges,
    feedbackEdges: globalTopology.feedback.size,
    algorithm: s.algorithm as LayoutAlgorithmId,
    name: ALGORITHMS.find(a => a.id === s.algorithm)!.name,
    mode: s.mode,
    scope,
    moved,
    maxDisplacement: +maxDisplacement.toFixed(2),
    rmsDisplacement: +Math.sqrt(sum2 / Math.max(1, moved)).toFixed(2),
    movementLimit: s.mode === 'pass' ? s.maxMove : null,
    iterations: run.totalIterations,
    batches: run.batchCount,
    before,
    after: metrics(),
    warnings: [...warnings],
    milliseconds: Date.now() - started,
    deterministic: s.mode === 'rebuild' && !opts.warmStart && s.algorithm !== 'separate',
    termination: opts.settle
      ? stops.some(p => p.reason === 'iteration limit')
        ? 'iteration limit'
        : stops.some(p => p.reason === 'objective plateau')
          ? 'objective plateau'
          : 'settled'
      : 'bounded pass',
    solverStops: stops,
  };
  captureTrace('Computed finish', true);
  return { document: doc, report, ...(opts.trace ? { trace } : {}) };
}
