import type { DiagramEdge, Direction } from '../../model/types.ts';
import { tickForces } from './forces.ts';
import { alignTarget, gridTarget, seedGrid } from './grid.ts';
import { hintsOf, hintTargets } from './intent.ts';
import { layeredTarget } from './layered.ts';
import { objective } from './objective.ts';
import { packIntoFrame } from './packing.ts';
import type { Scene } from './scene.ts';
import { createSeparation } from './separation.ts';
import { shortestPaths, topology } from './topology.ts';
import { bilateralTarget, forwardSign, radialTarget, treeTarget } from './trees.ts';
import type {
  Centres,
  Item,
  LayoutIntent,
  Link,
  Point,
  Rect,
  SolverStop,
  Topology,
} from './types.ts';
import { bounds, clamp, magnitude, midpoint, wait } from './util.ts';

/** A link with an end outside the solve, or between two of its items: `a` and `b` are the items that own its ends. */
export interface BoundaryLink extends DiagramEdge {
  a: string | null;
  b: string | null;
}

/** What one solve of one container's children shares with its force, separation and packing steps. */
export interface Batch {
  parentId: string | null;
  direction: Direction;
  items: Item[];
  byId: Map<string, Item>;
  t: Topology;
  localIntent: LayoutIntent;
  boundaryLinks: BoundaryLink[];
  /** Hop counts, for the stress solve only. */
  distances: Map<string, Map<string, number>> | null;
  target: Centres | null;
  /** The inside of the parent's frame, or null at the top level. */
  container: Rect | null;
  availableAspect: number;
  /** Each item's centre when the solve began. */
  origin: Centres;
  anchor: number;
  baseCenter: Point;
  pairGap(a: Item, b: Item): number;
  /** Copies the document's positions back onto the items. */
  sync(): void;
}

/**
 * Solves the children of one container: builds the target for the chosen algorithm, runs the
 * force ticks, and keeps the best state by collisions first and energy second.
 */
export async function arrange(
  scene: Scene,
  activeIds: string[],
  parentId: string | null,
  direction: Direction,
) {
  const {
      doc,
      s,
      opts,
      run,
      aspect,
      compound,
      intent,
      globalTopology,
      nodeIndex,
      pos,
      groups,
      child,
      parent,
      descend,
      fixed,
      visible,
      padded,
      move,
      resizeAuto,
      captureTrace,
    } = scene,
    { warnings, stops, seeded } = run;
  if (!activeIds.length) return;
  run.batchCount++;
  const all = child(parentId).filter(n => visible(n.id)),
    active = new Set(activeIds),
    idSet = new Set(all.map(n => n.id));
  const owner = (id: string | undefined) => {
    for (let p = id; p; p = parent(p)) if (idSet.has(p)) return p;
    return null;
  };
  const items = all.map(n => ({
    id: n.id,
    ...padded(n.id),
    fixed: !active.has(n.id) || fixed(n.id),
  }));
  if (items.every(p => p.fixed)) return;
  const localIntent: LayoutIntent = {};
  for (const [role, hint] of hintsOf(intent)) {
    const id = owner(hint.id);
    if (id) localIntent[role] = { ...hint, id };
  }
  if (localIntent.start?.id === localIntent.end?.id) delete localIntent.end;
  const local = {
    ...s,
    direction,
    rootId: localIntent.start?.id || owner(s.rootId) || '',
    fold: s.respectDirection ? 'never' : s.fold,
  };
  const edges = doc.graph.edges
      .map(e => ({ from: owner(e.from), to: owner(e.to), directed: e.directed !== false }))
      .filter(e => e.from && e.to && e.from !== e.to) as Link[],
    t = topology(items, edges, localIntent);
  // The order prior applies where the layered target is the drawing, not a seed for forces,
  // and to a flat drawing: centre lines say little about crossings between groups, and a
  // group's members are ranked without the outside edges that decide their order.
  // `orderPrior: false` restores the v7 behaviour (engine parity).
  if (
    opts.orderPrior !== false &&
    s.algorithm === 'layered' &&
    !parentId &&
    !items.some(p => groups.has(p.id))
  )
    t.declared = new Map(items.map(p => [p.id, nodeIndex.get(p.id) ?? Infinity]));
  const boundaryLinks = compound
    ? doc.graph.edges
        .map(e => ({ ...e, a: owner(e.from), b: owner(e.to) }))
        .filter(e => (e.a || e.b) && e.a !== e.b)
    : [];
  const globalRank = (id: string) => {
    const ids = groups.has(id) ? descend(id).filter(k => !groups.has(k)) : [id];
    return ids.length ? Math.min(...ids.map(k => globalTopology.rank.get(k) || 0)) : 0;
  };
  if (s.algorithm === 'compound-flow') {
    // Global leaf ranks are temporary ordering hints, never new graph edges.
    const ranks = [...new Set(items.map(p => globalRank(p.id)))].sort((a, b) => a - b);
    for (const p of items)
      t.rank.set(p.id, Math.max(t.rank.get(p.id) || 0, ranks.indexOf(globalRank(p.id))));
    const occupiedRanks = [...new Set(t.rank.values())].sort((a, b) => a - b);
    for (const [id, r] of t.rank) t.rank.set(id, occupiedRanks.indexOf(r));
    local.rankGap = Math.max(s.rankGap, items.some(p => groups.has(p.id)) ? s.groupGap : 0);
  }
  const pairGap = (a: Item, b: Item) =>
    compound && (groups.has(a.id) || groups.has(b.id)) ? s.groupGap : s.nodeGap;
  const compoundEnergy = !compound
    ? null
    : () => {
        let energy = 0;
        const v = direction === 'DOWN';
        for (const e of boundaryLinks) {
          const a = pos[e.from],
            b = pos[e.to];
          if (!a || !b) continue;
          const ca = midpoint(a),
            cb = midpoint(b),
            dx = cb.x - ca.x,
            dy = cb.y - ca.y,
            cross = v ? dx : dy,
            d = magnitude(dx, dy);
          const isBoundary = parent(e.from) !== parent(e.to) || !e.a || !e.b;
          const k = isBoundary ? s.boundaryPull / 100 : 0.35;
          const ideal = s.edgeLength + (Math.hypot(a.w, a.h) + Math.hypot(b.w, b.h)) / 4;
          if (s.algorithm === 'boundary-align')
            energy +=
              cross * cross * (0.025 + (s.alignment / 100) * 0.06) * k +
              (d - ideal) ** 2 * 0.001 * k;
          else energy += (d - ideal) ** 2 * 0.008 * k;
          if (s.algorithm === 'compound-flow') energy += cross * cross * 0.01 * k;
        }
        return energy;
      };
  const frame = parentId ? pos[parentId] : null,
    pad = doc.layout.containers[parentId!]?.padding || 24;
  const container = frame
    ? { x: frame.x + pad, y: frame.y + pad + 28, w: frame.w - pad * 2, h: frame.h - pad * 2 - 28 }
    : null;
  const availableAspect = container
    ? Math.max(0.3, container.w / Math.max(1, container.h))
    : aspect;
  let target = null;
  if (s.algorithm === 'layered' || s.algorithm === 'compound-flow')
    target = layeredTarget(items, t, local, availableAspect);
  if (s.algorithm === 'tree') target = treeTarget(items, t, local);
  if (s.algorithm === 'radial') target = radialTarget(items, t, local);
  if (s.algorithm === 'grid') target = gridTarget(items, local, availableAspect);
  const bilateral =
    localIntent.start?.placement === 'center' && s.algorithm !== 'separate'
      ? bilateralTarget(items, t, local)
      : null;
  if (bilateral && ['tree', 'layered', 'compound-flow'].includes(s.algorithm)) target = bilateral;
  if (target && !(s.algorithm === 'grid' && s.mode === 'pass'))
    alignTarget(target, items, container, s.mode === 'rebuild' && !opts.warmStart);
  // Canonical rebuild initialisation is ID-sorted and geometry-aware.
  // Separate overlaps is a repair operation: even rebuild retains its input.
  if (
    s.mode === 'rebuild' &&
    !opts.warmStart &&
    s.algorithm !== 'separate' &&
    (!compound || !seeded.has(parentId))
  ) {
    seeded.add(parentId);
    const seed =
      target ||
      (bilateral ? alignTarget(bilateral, items, container, true) : null) ||
      alignTarget(
        s.respectDirection && t.forward.length
          ? layeredTarget(items, t, { ...local, fold: 'never' }, availableAspect)
          : seedGrid(items, s, availableAspect),
        items,
        container,
        true,
      );
    for (const p of items)
      if (!p.fixed) {
        const q = seed.get(p.id)!;
        let x = q.x - p.w / 2,
          y = q.y - p.h / 2;
        if (container && !s.growContainers) {
          if (p.w <= container.w) x = clamp(x, container.x, container.x + container.w - p.w);
          if (p.h <= container.h) y = clamp(y, container.y, container.y + container.h - p.h);
        }
        move(p.id, x - pos[p.id].x, y - pos[p.id].y);
      }
  }
  const sync = () =>
    items.forEach(p => {
      p.x = pos[p.id].x;
      p.y = pos[p.id].y;
    });
  sync();
  const origin = new Map(items.map(p => [p.id, midpoint(p)])),
    byId = new Map(items.map(p => [p.id, p])),
    velocity = new Map(items.map(p => [p.id, { x: 0, y: 0 }]));
  const distances = s.algorithm === 'stress' ? shortestPaths(t) : null;
  const baseB = bounds(items),
    baseCenter = midpoint(baseB),
    anchor = s.mode === 'pass' ? (s.stability / 100) ** 2 * 0.18 : 0;
  const steps = opts.settle
    ? clamp(Math.round(opts.maxIterations || 640), 80, 1200)
    : s.mode === 'rebuild'
      ? Math.max(80, s.iterations * 3)
      : s.iterations;
  let quiet = 0,
    plateau = 0,
    stop: SolverStop['reason'] = 'iteration limit',
    ran = 0;
  const batch: Batch = {
    parentId,
    direction,
    items,
    byId,
    t,
    localIntent,
    boundaryLinks,
    distances,
    target,
    container,
    availableAspect,
    origin,
    anchor,
    baseCenter,
    pairGap,
    sync,
  };
  const { constrainedMove, axisCapacity, separate, collisions } = createSeparation(scene, batch);
  let best = {
    coords: new Map(items.map(p => [p.id, { x: p.x, y: p.y }])),
    collisions: collisions(),
    energy: objective(items, t, local, distances, target, compoundEnergy),
  };
  for (let tick = 0; tick < steps; tick++) {
    run.totalIterations++;
    ran++;
    const tickStart = items.map(p => ({ x: p.x, y: p.y }));
    const forces = tickForces(scene, batch);
    for (const p of items) {
      if (p.fixed) continue;
      const f = forces.get(p.id)!,
        v = velocity.get(p.id)!,
        limit =
          s.mode === 'pass' ? Math.max(1, s.maxMove * 0.13) : Math.max(2, 32 * (1 - tick / steps));
      v.x = v.x * 0.28 + f.x * 0.72;
      v.y = v.y * 0.28 + f.y * 0.72;
      const n = magnitude(v.x, v.y),
        k = n > limit ? limit / n : 1;
      constrainedMove(p, v.x * k, v.y * k);
    }
    separate(s.algorithm === 'separate' ? 6 : 3);
    // Project feasible forward inequalities, using the same boundary/pin/
    // per-action budget guards as every other movement. A second collision
    // projection keeps directional improvement subordinate to feasibility.
    if (s.respectDirection && s.algorithm !== 'separate')
      for (let sweep = 0; sweep < 2; sweep++) {
        const seq = sweep ? t.forward.slice().reverse() : t.forward;
        for (const e of seq) {
          const a = byId.get(e.from)!,
            b = byId.get(e.to)!,
            v = direction === 'DOWN',
            axis = v ? 'y' : 'x';
          const gap = (v ? a.h + b.h : a.w + b.w) / 2 + s.rankGap;
          const sign = forwardSign(t, e);
          if (!sign) continue;
          const error = gap - (midpoint(b)[axis] - midpoint(a)[axis]) * sign;
          if (error <= 0.01) continue;
          const ac = axisCapacity(a, axis, -sign),
            bc = axisCapacity(b, axis, sign),
            need = error * (s.mode === 'pass' ? 0.4 : 0.95);
          const da = Math.min(ac, bc < need / 2 ? need - bc : need / 2),
            db = Math.min(bc, need - da);
          constrainedMove(a, v ? 0 : -da * sign, v ? -da * sign : 0);
          constrainedMove(b, v ? 0 : db * sign, v ? db * sign : 0);
        }
      }
    separate(2);
    const c = collisions(),
      energy = objective(items, t, local, distances, target, compoundEnergy);
    // Feasibility is lexicographic. A prettier target never justifies a new collision.
    if (
      c.n < best.collisions.n ||
      (c.n === best.collisions.n &&
        (c.a < best.collisions.a - 0.1 ||
          (Math.abs(c.a - best.collisions.a) < 0.1 &&
            (energy < best.energy - 0.001 || s.algorithm === 'separate'))))
    ) {
      best = {
        coords: new Map(items.map(p => [p.id, { x: p.x, y: p.y }])),
        collisions: c,
        energy,
      };
      plateau = 0;
    } else plateau++;
    const travel = Math.max(
      ...items.map((p, i) => magnitude(p.x - tickStart[i].x, p.y - tickStart[i].y)),
      0,
    );
    quiet = travel < (opts.tolerance || 0.08) ? quiet + 1 : 0;
    if (opts.settle && tick >= 40 && (quiet >= 12 || plateau >= 80)) {
      stop = quiet >= 12 ? 'settled' : 'objective plateau';
      break;
    }
    if (tick % 4 === 3)
      captureTrace(
        'Refining ' + (parentId ? groups.get(parentId)?.title || 'container' : 'diagram'),
      );
    if (tick % 12 === 11) await wait();
  }
  stops.push({ parentId, iterations: ran, reason: stop });
  for (const p of items) {
    const bestPos = best.coords.get(p.id)!;
    move(p.id, bestPos.x - pos[p.id].x, bestPos.y - pos[p.id].y);
  }
  sync();
  // Prefer the requested region after optimization, but never spend more
  // displacement, violate a fixed frame/pin, or introduce an overlap.
  if (s.algorithm !== 'separate')
    for (let pass = 0; pass < 4; pass++)
      for (const [id, q] of hintTargets(items, localIntent)) {
        const p = byId.get(id);
        if (!p || p.fixed) continue;
        const saved = new Map(items.map(p => [p.id, { x: p.x, y: p.y }])),
          beforeCollision = collisions(),
          c = midpoint(p);
        constrainedMove(p, (q.x - c.x) * 0.65, (q.y - c.y) * 0.65);
        const now = collisions();
        if (now.n > beforeCollision.n || now.a > beforeCollision.a + 0.01) {
          for (const [key, old] of saved) move(key, old.x - pos[key].x, old.y - pos[key].y);
          sync();
        }
      }
  // A structural target can be wider/taller than a fixed frame. In rebuild
  // mode only, try deterministic edge-candidate packing before accepting
  // colliding rectangles. This never grows a frame or moves a hard pin.
  packIntoFrame(scene, batch, best.collisions.n);
  if (collisions().n)
    warnings.add(
      'Some overlaps remain. Pins, fixed frames or the movement limit may prevent this pass from clearing them.',
    );
  if (parentId) resizeAuto(parentId);
  captureTrace(
    'Finished ' + (parentId ? groups.get(parentId)?.title || 'container' : 'diagram'),
    true,
  );
}
