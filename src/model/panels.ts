/**
 * The two versions inside a document with change marks. Both keep the merged document's
 * positions, so every unchanged object sits at the same place in each panel.
 */
import { GROUP_INSET, GROUP_TITLE_CHROME } from '../dsl/frame';
import { resolveAppearance } from './appearance';
import { measureText } from './fonts';
import type { Diagram } from './types';

export type PanelSide = 'before' | 'after';

/**
 * The merged document with each change as it was: old labels, shapes, counts, rows and phase
 * bands. Every object stays in its place and every line stays in.
 */
export function oldDoc(doc: Diagram): Diagram {
  const styles = { ...doc.styles },
    seq = doc.layout.sequence,
    grow = seq?.before?.grow ?? 0;
  for (const n of doc.graph.nodes)
    if (n.wasShape) styles[n.id] = { ...styles[n.id], shape: n.wasShape };
  const edges = { ...doc.layout.edges },
    boxes = { ...doc.layout.nodes };
  for (const [id, row] of Object.entries(seq?.before?.rows ?? {}))
    edges[id] = { ...edges[id], row };
  // A sequence's groups are column bands, as long as its lifelines.
  if (grow)
    for (const g of doc.graph.groups) boxes[g.id] = { ...boxes[g.id], h: boxes[g.id].h + grow };
  return {
    ...doc,
    styles,
    layout: {
      ...doc.layout,
      edges,
      nodes: boxes,
      ...(seq?.before
        ? {
            sequence: {
              ...seq,
              phases: seq.before.phases,
              activations: seq.before.activations,
              panel: { ...seq.panel, h: seq.panel.h + grow },
            },
          }
        : {}),
    },
    graph: {
      nodes: doc.graph.nodes.map(n => ({
        ...n,
        title: n.was ?? n.title,
        ...(n.wasCount !== undefined ? { count: n.wasCount === 1 ? undefined : n.wasCount } : {}),
        ...(n.lifeline ? { lifeline: n.lifeline + grow } : {}),
      })),
      groups: doc.graph.groups.map(g => ({ ...g, title: g.was ?? g.title })),
      edges: doc.graph.edges.map(e => ({ ...e, label: e.was ?? e.label })),
    },
  };
}

/** Panels repeat the drawing and put its notes in the frame, so a sequence drops its margins. */
export function withoutMargins(doc: Diagram): Diagram {
  const seq = doc.layout.sequence;
  if (!seq?.inner) return doc;
  const { inner, notes: _notes, phaseX: _phaseX, ...rest } = seq;
  return { ...doc, layout: { ...doc.layout, sequence: { ...rest, panel: inner } } };
}

/** The document as it was (`before`: no added objects, old values) or is (`after`: no removed). */
export function panelDoc(doc: Diagram, side: PanelSide): Diagram {
  const hidden = side === 'before' ? 'added' : 'removed',
    keep = (id: string) => doc.styles[id]?.status !== hidden,
    plain = withoutMargins(doc),
    version = side === 'before' ? oldDoc(plain) : plain;
  const nodes = version.graph.nodes.filter(n => keep(n.id));
  const ids = new Set(nodes.map(n => n.id));
  return fitFrames(
    {
      ...version,
      graph: {
        nodes,
        groups: version.graph.groups.filter(g => keep(g.id)),
        edges: version.graph.edges.filter(
          e => e.status !== hidden && ids.has(e.from) && ids.has(e.to),
        ),
      },
    },
    new Set(
      doc.graph.groups
        .filter(g => !keep(g.id))
        .map(g => g.id)
        .concat(doc.graph.nodes.filter(n => !keep(n.id)).map(n => n.id)),
    ),
    doc,
  );
}

/**
 * Shrink each container that lost members in this panel to fit what is left, on every side.
 * Only the frame moves, so the panels still line up; the space the other
 * version's objects needed simply goes away. Innermost containers fit first.
 */
function fitFrames(panel: Diagram, gone: Set<string>, merged: Diagram): Diagram {
  if (!gone.size) return panel;
  const parent = new Map(
    [...merged.graph.nodes, ...merged.graph.groups].map(o => [o.id, o.parentId]),
  );
  const lost = new Set<string>();
  for (const id of gone) for (let p = parent.get(id); p; p = parent.get(p)) lost.add(p);
  const look = resolveAppearance(panel.appearance),
    layout = { ...panel.layout.nodes },
    depth = (id: string) => {
      let d = 0;
      for (let p = parent.get(id); p; p = parent.get(p)) d++;
      return d;
    };
  const members = [...panel.graph.nodes, ...panel.graph.groups];
  for (const g of panel.graph.groups
    .filter(g => lost.has(g.id))
    .sort((a, b) => depth(b.id) - depth(a.id))) {
    const frame = layout[g.id],
      inside = members.filter(o => o.parentId === g.id).map(o => layout[o.id]);
    if (!frame || !inside.length) continue;
    const right = Math.min(
        frame.x + frame.w,
        Math.max(...inside.map(r => r.x + r.w)) + GROUP_INSET,
      ),
      bottom = Math.min(frame.y + frame.h, Math.max(...inside.map(r => r.y + r.h)) + GROUP_INSET),
      title = measureText(g.title, look.groupTitle) + GROUP_TITLE_CHROME,
      left = Math.max(frame.x, Math.min(...inside.map(r => r.x)) - GROUP_INSET),
      top = Math.max(frame.y, Math.min(...inside.map(r => r.y)) - look.groupHeader),
      // A title wider than what is left keeps the frame's old left edge, as far as it needs.
      x = Math.max(frame.x, Math.min(left, right - title)),
      y = Math.max(frame.y, Math.min(top, bottom - look.groupHeader - GROUP_INSET));
    layout[g.id] = {
      ...frame,
      x,
      y,
      w: Math.min(frame.x + frame.w, Math.max(right, x + title)) - x,
      h: bottom - y,
    };
  }
  return { ...panel, layout: { ...panel.layout, nodes: layout } };
}
