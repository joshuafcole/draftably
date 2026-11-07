/**
 * The session's view state as a host sees it: what is selected, what is under the pointer, and
 * what the user opened. A host that drives the canvas from its own state (a URL, an inspector)
 * sets them here and hears the user's changes through `SessionOptions`; nothing here moves the
 * drawing.
 */
import { createEffect, createSignal, on } from 'solid-js';
import { findEdge, findGroup, findNode } from '../../model/graph';
import { parseTextId, textId, type CanvasTextPart } from './canvas-text';
import type { DocumentPart } from './document';

/** What kind of thing an id names on the canvas: an object, or a note with an ID. */
export type ViewItemKind = 'node' | 'edge' | 'group' | 'note';

/** An object the user selected, pointed at or opened. */
export interface ViewItem {
  id: string;
  kind: ViewItemKind;
}

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every(id => b.has(id));

export function createView(s: DocumentPart & CanvasTextPart) {
  const { onSelect, onHover, onActivate } = s.options;
  const [hovered, setHoveredSignal] = createSignal<string | null>(null);

  /** Where in the file's notes the note with ID `id` is, or -1. */
  const noteIndex = (id: string) => (s.doc.appearance.notes ?? []).findIndex(n => n.id === id);

  /** The object or note `id` names, with its kind, or undefined when the drawing has none. */
  function viewItem(id: string): ViewItem | undefined {
    if (findNode(s.doc, id)) return { id, kind: 'node' };
    if (findGroup(s.doc, id)) return { id, kind: 'group' };
    if (findEdge(s.doc, id)) return { id, kind: 'edge' };
    if (noteIndex(id) >= 0) return { id, kind: 'note' };
    return undefined;
  }
  const viewItems = (ids: Iterable<string>) =>
    [...ids].map(viewItem).filter((item): item is ViewItem => !!item);

  /**
   * The ids selected, as a host names them: the selected objects, or the selected note when it
   * has an ID. A note is selected alone, as a click on it selects it.
   */
  function selectedIds(): ReadonlySet<string> {
    const text = parseTextId(s.selectedText()),
      note = text?.kind === 'note' ? s.doc.appearance.notes?.[Number(text.key)] : undefined;
    return note?.id ? new Set([note.id]) : s.selection();
  }

  // `onSelect` hears every change of the selection except one the host made through
  // `showSelection`, so a host that mirrors the selection into its own state hears no echo.
  let reported: ReadonlySet<string> = new Set();
  createEffect(
    on(
      selectedIds,
      selection => {
        if (sameIds(selection, reported)) return;
        reported = new Set(selection);
        onSelect?.(viewItems(selection));
      },
      { defer: true },
    ),
  );

  /**
   * Select `ids` for the host. Ids the drawing does not have are dropped; geometry never moves.
   * A note's ID selects that note alone, in place of any objects, as a click on it does.
   */
  function showSelection(ids: Iterable<string>) {
    const known = [...ids].filter(id => viewItem(id)),
      note = known.find(id => viewItem(id)!.kind === 'note');
    if (note) {
      reported = new Set([note]);
      s.selectText(textId('note', noteIndex(note)));
      return;
    }
    reported = new Set(known);
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
