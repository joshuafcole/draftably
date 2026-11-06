/**
 * The session's view state as a host sees it: what is selected, what is under the pointer, and
 * what the user opened. A host that drives the canvas from its own state (a URL, an inspector)
 * sets them here and hears the user's changes through `SessionOptions`; nothing here moves the
 * drawing.
 */
import { createEffect, createSignal, on } from 'solid-js';
import { findEdge, findGroup, findNode } from '../../model/graph';
import type { DocumentPart } from './document';

/** What kind of object an id names on the canvas. */
export type ViewItemKind = 'node' | 'edge' | 'group';

/** An object the user selected, pointed at or opened. */
export interface ViewItem {
  id: string;
  kind: ViewItemKind;
}

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every(id => b.has(id));

export function createView(s: DocumentPart) {
  const { onSelect, onHover, onActivate } = s.options;
  const [hovered, setHoveredSignal] = createSignal<string | null>(null);

  /** The object `id` names, with its kind, or undefined when the drawing has none. */
  function viewItem(id: string): ViewItem | undefined {
    if (findNode(s.doc, id)) return { id, kind: 'node' };
    if (findGroup(s.doc, id)) return { id, kind: 'group' };
    if (findEdge(s.doc, id)) return { id, kind: 'edge' };
    return undefined;
  }
  const viewItems = (ids: Iterable<string>) =>
    [...ids].map(viewItem).filter((item): item is ViewItem => !!item);

  // `onSelect` hears every change of the selection except one the host made through
  // `showSelection`, so a host that mirrors the selection into its own state hears no echo.
  let reported: ReadonlySet<string> = new Set();
  createEffect(
    on(
      s.selection,
      selection => {
        if (sameIds(selection, reported)) return;
        reported = new Set(selection);
        onSelect?.(viewItems(selection));
      },
      { defer: true },
    ),
  );

  /** Select `ids` for the host. Ids the drawing does not have are dropped; geometry never moves. */
  function showSelection(ids: Iterable<string>) {
    reported = new Set([...ids].filter(id => viewItem(id)));
    s.setSelection(reported);
  }

  /** The object drawn as hovered: the one under the pointer, or the one the host points at. */
  const hoveredId = hovered;

  /** Draw `id` as hovered for the host, as if the pointer were over it. Reports nothing. */
  const showHover = (id: string | null) => setHoveredSignal(id && viewItem(id) ? id : null);

  /** The pointer moved onto `id`, or off every object; reports a change through `onHover`. */
  function pointAt(id: string | null) {
    const next = id && viewItem(id) ? id : null;
    if (next === hovered()) return;
    setHoveredSignal(next);
    onHover?.(next ? viewItem(next)! : null);
  }

  /** The user opened `id` (a double click, or Enter on it). Reports through `onActivate`. */
  function activate(id: string | undefined | null) {
    const item = id ? viewItem(id) : undefined;
    if (item) onActivate?.(item);
    return !!item;
  }

  return { viewItem, showSelection, hoveredId, showHover, pointAt, activate };
}

export type ViewPart = ReturnType<typeof createView>;
