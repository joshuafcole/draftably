/**
 * Canvas shortcuts and shape copy and paste for the active session. The app runs its own keys
 * around these in `keyboard.ts`; an embedded editor uses them as they are.
 */

import { findEdge, findNode } from '../model/graph';
import { isClipboardFragment } from '../model/edits';
import type { Side } from '../model/types';
import { runCanvasCommand, type CanvasCommandId } from './canvas-commands';
import { type Tool } from './session/editor';
import { parseTextId, removeText, TEXT_NAMES } from './session/canvas-text';
import { shortcutKey } from './keys';
import { toast } from './toast';
import { activeSession } from './active-session';

export const isEditable = (el: EventTarget | null) =>
  el instanceof Element && el.matches('input,textarea,select,[contenteditable=true]');

/** Keyboard focus on a button keeps Space. A button a click left focused still lets Space pan. */
const keepsSpace = (el: EventTarget | null) =>
  el instanceof Element && el.matches('button:focus-visible,summary:focus-visible');

const ARROW_SIDES: Record<string, Side> = {
  ArrowRight: 'right',
  ArrowLeft: 'left',
  ArrowUp: 'top',
  ArrowDown: 'bottom',
};

const KEY_COMMANDS: Record<string, CanvasCommandId> = {
  n: 'add-node',
  p: 'pin',
  '1': 'fit',
  '0': 'reset-camera',
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
};

const KEY_TOOLS: Record<string, Tool> = {
  v: 'select',
  h: 'pan',
  c: 'connect',
  r: 'box',
  d: 'diamond',
  o: 'circle',
  t: 'text',
  g: 'container',
};

/** The canvas object a key event targets: the focused shape, or the selection. */
function focusedObject(target: Element) {
  const el = target.closest?.('[data-id]') as HTMLElement | SVGElement | null;
  return el?.dataset.id;
}

/**
 * Run the canvas shortcut for `e`. True when the key was used, or belongs to a field, so the host
 * should not act on it. `closeMenu` lets Escape close the host's open menu, before it clears the
 * selection; it returns true when it closed one.
 */
export function handleCanvasKey(e: KeyboardEvent, closeMenu?: () => boolean): boolean {
  if (activeSession().readOnly()) return handleViewKey(e, closeMenu);
  if (e.isComposing || activeSession().sculptKey(e)) return true;
  const mod = e.ctrlKey || e.metaKey,
    key = shortcutKey(e),
    target = e.target as Element;

  if (e.key === 'Escape') {
    if (activeSession().layoutBusy())
      return (e.preventDefault(), activeSession().cancelLayout(), true);
    if (activeSession().layoutPreview())
      return (e.preventDefault(), activeSession().discardPreview(), true);
    if (activeSession().inlineEditId()) return true;
    if (closeMenu?.()) return (e.preventDefault(), true);
    e.preventDefault();
    activeSession().cancelGesture();
    activeSession().setConnectFrom(null);
    if (activeSession().tool() !== 'select') return (activeSession().setTool('select'), true);
    activeSession().clearSelection();
    activeSession().focusCanvas();
    return true;
  }
  if (isEditable(target)) return true;

  if (e.code === 'Space' && keepsSpace(target)) return true;
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    activeSession().setSpaceHeld(true);
    return true;
  }

  if (mod) {
    const shortcuts: Record<string, () => void> = {
      z: () => runCanvasCommand(e.shiftKey ? 'redo' : 'undo'),
      y: () => runCanvasCommand('redo'),
      a: () =>
        activeSession().setSelection(
          activeSession()
            .visibleScene()
            .nodes.map(n => n.id),
        ),
      d: () => runCanvasCommand('duplicate'),
      g: () => runCanvasCommand(e.shiftKey ? 'ungroup' : 'group'),
    };
    if (!shortcuts[key]) return false;
    e.preventDefault();
    shortcuts[key]();
    return true;
  }

  const onCanvas = target === document.querySelector('.canvas') || !!target.closest?.('[data-id]');
  const focusedId = focusedObject(target);

  // Keep from anywhere, including the Arrange button that started the preview.
  if (
    e.key === 'Enter' &&
    activeSession().layoutPreview() &&
    !target.closest?.('.layout-preview')
  ) {
    e.preventDefault();
    activeSession().acceptPreview();
    return true;
  }

  const quickAdd = target.closest?.('[data-quick-add]') as SVGElement | null;
  if (e.key === 'Enter' && quickAdd) {
    e.preventDefault();
    activeSession().setSelection([quickAdd.dataset.owner!]);
    activeSession().quickExtend({ side: quickAdd.dataset.quickAdd as Side });
    return true;
  }

  if (e.key === 'Enter') {
    if (target.tagName === 'BUTTON') return true;
    e.preventDefault();
    if (activeSession().tool() === 'connect') {
      const id =
        focusedId && findNode(activeSession().doc, focusedId)
          ? focusedId
          : activeSession()
              .selectedIds()
              .find(id => findNode(activeSession().doc, id));
      if (!id) return true;
      if (activeSession().connectFrom()) activeSession().completeConnection(id);
      else activeSession().setConnectFrom({ id, side: 'auto' });
      return true;
    }
    if (e.shiftKey) return (runCanvasCommand('add-connected'), true);
    const id = focusedId || activeSession().selectedIds()[0] || activeSession().selectedText();
    if (id) activeSession().startInlineEdit(id);
    return true;
  }

  if (e.key === 'Tab' && onCanvas) {
    if (activeSession().tool() === 'connect') {
      // Tab moves between connection targets.
      const targets = activeSession()
          .visibleScene()
          .nodes.map(n => n.id),
        anchor =
          focusedId ||
          activeSession()
            .selectedIds()
            .find(id => findNode(activeSession().doc, id)),
        i = targets.indexOf(anchor ?? ''),
        next = targets[(i + (e.shiftKey ? -1 : 1) + targets.length) % targets.length];
      if (next) {
        e.preventDefault();
        activeSession().setSelection([next]);
        (document.querySelector(`[data-id="${CSS.escape(next)}"]`) as SVGElement | null)?.focus({
          preventScroll: true,
        });
      }
      return true;
    }
    const only = activeSession().singleSelection();
    if (only && (findNode(activeSession().doc, only) || findEdge(activeSession().doc, only))) {
      e.preventDefault();
      activeSession().quickExtend({ sibling: e.shiftKey });
    }
    return true;
  }

  if (e.altKey && ARROW_SIDES[e.key] && onCanvas) {
    e.preventDefault();
    activeSession().quickExtend({ side: ARROW_SIDES[e.key] });
    return true;
  }
  if (e.altKey && key === 's')
    return (e.preventDefault(), activeSession().markSelectedAs('start'), true);
  if (e.altKey && e.key === 'End')
    return (e.preventDefault(), activeSession().markSelectedAs('end'), true);
  if (e.altKey && key === 'r')
    return (e.preventDefault(), runCanvasCommand(e.shiftKey ? 'auto-ports' : 'reroute'), true);
  if ((key === '[' || key === ']') && !e.altKey && activeSession().stepState(key === ']' ? 1 : -1))
    return (e.preventDefault(), true);
  if ((e.key === 'Delete' || e.key === 'Backspace') && activeSession().selectedText()) {
    const id = activeSession().selectedText()!;
    e.preventDefault();
    if (parseTextId(id)?.kind === 'phase') return (toast('A phase needs its label.'), true);
    activeSession().transact(`Delete ${TEXT_NAMES[parseTextId(id)!.kind]}`, d => removeText(d, id));
    activeSession().clearSelection();
    return true;
  }
  if (e.key === 'Delete' || e.key === 'Backspace')
    return (e.preventDefault(), runCanvasCommand(e.shiftKey ? 'delete-deep' : 'delete'), true);

  if (ARROW_SIDES[e.key] && onCanvas) {
    e.preventDefault();
    if (focusedId && !activeSession().selection().has(focusedId))
      activeSession().setSelection([focusedId]);
    const amount = e.shiftKey ? 10 : 1,
      dx = e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0,
      dy = e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0;
    // With nothing selected, arrows pan the canvas.
    if (!activeSession().nudgeSelection(dx, dy)) activeSession().panBy(-dx * 30, -dy * 30);
    return true;
  }

  if (key === 'l' && !e.altKey) {
    e.preventDefault();
    runCanvasCommand(e.shiftKey ? 'layout-rebuild' : 'layout');
    return true;
  }
  if (KEY_COMMANDS[key]) {
    e.preventDefault();
    runCanvasCommand(KEY_COMMANDS[key]);
    return true;
  }
  if (KEY_TOOLS[key]) {
    e.preventDefault();
    activeSession().setTool(KEY_TOOLS[key]);
    return true;
  }
  return false;
}

/** Commands a read-only canvas keeps: they move the view, never the drawing. */
const VIEW_COMMANDS = new Set<CanvasCommandId>(['fit', 'reset-camera', 'zoom-in', 'zoom-out']);

/**
 * The keys of a read-only canvas: Enter activates the focused or selected object, Escape clears
 * the selection, Space pans, arrows pan, [ and ] step the emphasis state, and the zoom keys zoom.
 */
function handleViewKey(e: KeyboardEvent, closeMenu?: () => boolean): boolean {
  const s = activeSession(),
    target = e.target as Element,
    key = shortcutKey(e);
  if (e.isComposing || isEditable(target)) return true;
  if (e.key === 'Escape') {
    if (closeMenu?.()) return (e.preventDefault(), true);
    e.preventDefault();
    s.cancelGesture();
    s.clearSelection();
    return true;
  }
  if (e.code === 'Space' && keepsSpace(target)) return true;
  if (e.code === 'Space' && !e.repeat) return (e.preventDefault(), s.setSpaceHeld(true), true);
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === 'Enter') {
    if (target.tagName === 'BUTTON') return true;
    e.preventDefault();
    s.activate(focusedObject(target) ?? s.singleSelection());
    return true;
  }
  const onCanvas = target === document.querySelector('.canvas') || !!target.closest?.('[data-id]');
  if (ARROW_SIDES[e.key] && onCanvas) {
    e.preventDefault();
    const amount = e.shiftKey ? 10 : 1,
      dx = e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0,
      dy = e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0;
    s.panBy(-dx * 30, -dy * 30);
    return true;
  }
  if ((key === '[' || key === ']') && s.stepState(key === ']' ? 1 : -1))
    return (e.preventDefault(), true);
  const command = KEY_COMMANDS[key];
  if (command && VIEW_COMMANDS.has(command)) {
    e.preventDefault();
    runCanvasCommand(command);
    return true;
  }
  return false;
}

export function handleKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') activeSession().setSpaceHeld(false);
}

export function copyShapes(e: ClipboardEvent) {
  if (isEditable(e.target) || !activeSession().selection().size) return;
  const part = activeSession().copySelection();
  e.clipboardData?.setData('text/plain', JSON.stringify(part));
  e.preventDefault();
}

/** Paste copied shapes: from the clipboard text, or the session's own copy when it is empty. */
export function pasteShapes(e: ClipboardEvent) {
  if (isEditable(e.target) || !e.clipboardData || activeSession().readOnly()) return;
  const text = e.clipboardData.getData('text/plain').trim();
  try {
    if (text.startsWith('{')) {
      const data = JSON.parse(text);
      if (!isClipboardFragment(data)) return;
      e.preventDefault();
      activeSession().pasteFragment(data);
      return;
    }
    if (!text && activeSession().hasClipboard()) {
      e.preventDefault();
      activeSession().pasteFragment();
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}
