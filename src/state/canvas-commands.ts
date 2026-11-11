/**
 * Commands that act only on the active diagram session: the ones the canvas and its shortcuts run.
 * The app adds its own commands around these in `commands.ts`.
 */
import { activeSession } from './active-session';
import { toast } from './toast';

export interface Command {
  label: string;
  /** Shortcut shown in menus. */
  keys?: string;
  icon?: string;
  /** What it does, in a sentence: shown in tooltips and the palette. */
  hint?: string;
  run: () => unknown;
  /** Allowed while a timeline preview is open. */
  duringTimeline?: boolean;
  /** Exits the brush before running. */
  endsBrush?: boolean;
  enabled?: () => boolean;
  /** Why this cannot work here, shown instead of running it. */
  blocked?: () => string | null;
}

function undoCommand() {
  if (activeSession().sculptUndo()) return;
  if (activeSession().layoutPreview()) return activeSession().discardPreview();
  activeSession().undo();
}

function redoCommand() {
  if (activeSession().timelineOpen()) activeSession().closeTimeline();
  activeSession().redo();
}

export const hasSelection = () => activeSession().selectedIds().length > 0;

export const canvasCommands = {
  undo: {
    hint: 'Step back through your last edit.',
    label: 'Undo',
    keys: '⌘Z',
    icon: 'undo',
    run: undoCommand,
    duringTimeline: true,
    enabled: () => activeSession().canUndo(),
  },
  redo: {
    hint: 'Put back the edit you just undid.',
    label: 'Redo',
    keys: '⇧⌘Z',
    icon: 'redo',
    run: redoCommand,
    enabled: () => activeSession().canRedo(),
  },
  'add-node': {
    hint: 'Add a box to the canvas and start typing its label.',
    label: 'Add box',
    keys: 'N',
    icon: 'plus',
    run: () => {
      activeSession().setTool('select');
      activeSession().addNode({}, undefined, true);
    },
  },
  'add-connected': {
    hint: 'Add a box joined to the selected shape.',
    label: 'Add connected box',
    keys: '⇧ Enter',
    icon: 'connect',
    run: () => activeSession().quickExtend(),
  },
  duplicate: {
    hint: 'Copy the selection beside itself.',
    enabled: hasSelection,
    label: 'Duplicate',
    keys: '⌘D',
    icon: 'copy',
    run: () => activeSession().duplicateSelection(),
  },
  group: {
    hint: 'Frame the selection in a new container.',
    enabled: hasSelection,
    label: 'Wrap in container',
    keys: '⌘G',
    icon: 'group',
    run: () => activeSession().wrapSelection(),
  },
  ungroup: {
    hint: 'Remove the container and keep its contents.',
    enabled: hasSelection,
    label: 'Ungroup',
    keys: '⇧⌘G',
    run: () => activeSession().ungroupSelection(),
  },
  pin: {
    hint: 'Stop layout tools from moving the selection.',
    enabled: hasSelection,
    label: 'Toggle pin',
    keys: 'P',
    icon: 'pin',
    run: () => activeSession().togglePin(),
  },
  delete: {
    hint: 'Remove the selection and keep the contents of containers.',
    label: 'Delete selection',
    enabled: hasSelection,
    keys: '⌫',
    icon: 'trash',
    run: () => activeSession().deleteSelection(),
  },
  'delete-deep': {
    label: 'Delete with contents',
    keys: '⇧⌫',
    run: () => activeSession().deleteSelection(true),
  },
  layout: {
    hint: 'Small moves that shorten long lines and line up neighbours. Your arrangement stays.',
    label: 'Tidy',
    keys: 'L',
    icon: 'layout',
    run: () => activeSession().runLabLayout(),
    blocked: () => activeSession().movesBlocked(),
    endsBrush: true,
  },
  'layout-rebuild': {
    hint: "Run the automatic layout again from the file's recipe, without hand placements.",
    label: 'Lay out again',
    keys: '⇧L',
    run: () => activeSession().runLabLayout('rebuild', true),
    blocked: () => activeSession().rebuildBlocked(),
    endsBrush: true,
  },
  'layout-accept': { label: 'Keep preview', run: () => activeSession().acceptPreview() },
  'layout-discard': { label: 'Discard', run: () => activeSession().discardPreview() },
  reroute: {
    hint: 'Redraw every connection. Shapes stay where they are.',
    label: 'Reroute connections',
    keys: '⌥R',
    icon: 'branch',
    run: () => activeSession().reroute(),
  },
  'auto-ports': {
    hint: 'Let the router choose sides for the selected lines.',
    label: 'Use auto ports on selection',
    keys: '⌥⇧R',
    run: () => activeSession().reroute({ auto: true }),
  },
  fit: {
    hint: 'Zoom so the whole diagram fills the view.',
    label: 'Fit diagram',
    keys: '1',
    icon: 'fit',
    run: () => activeSession().fitView('user'),
    duringTimeline: true,
  },
  'zoom-in': {
    label: 'Zoom in',
    keys: '+',
    icon: 'plus',
    run: () => activeSession().zoomAt(1.18),
    duringTimeline: true,
  },
  'zoom-out': {
    label: 'Zoom out',
    keys: '−',
    icon: 'minus',
    run: () => activeSession().zoomAt(1 / 1.18),
    duringTimeline: true,
  },
  'reset-camera': {
    label: 'Zoom to 100%',
    keys: '0',
    run: () => activeSession().zoomAt(1 / activeSession().doc.camera.k),
    duringTimeline: true,
  },
} satisfies Record<string, Command>;

export type CanvasCommandId = keyof typeof canvasCommands;

/** Run `command` unless a timeline preview or its own check blocks it, reporting failures. */
export function runChecked(id: string, command: Command) {
  if (activeSession().timelineOpen() && !command.duringTimeline) {
    toast('Preview only. Keep this step or press Escape to cancel.');
    return;
  }
  const blocked = command.blocked?.();
  if (blocked) return void toast(blocked);
  if (command.endsBrush && activeSession().brushActive()) activeSession().deactivateBrush();
  try {
    const result = command.run();
    if (result instanceof Promise)
      result.catch(error => toast(error instanceof Error ? error.message : String(error)));
  } catch (error) {
    console.warn('[diagram-studio] command failed', id, error);
    toast(error instanceof Error ? error.message : String(error));
  }
}

export const checkedEnabled = (command: Command) =>
  !command.blocked?.() && (command.enabled ? command.enabled() : true);

export const runCanvasCommand = (id: CanvasCommandId) => runChecked(id, canvasCommands[id]);
export const canvasCommandEnabled = (id: CanvasCommandId) => checkedEnabled(canvasCommands[id]);
