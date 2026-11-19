/**
 * Named commands shared by the toolbar, menus and keyboard shortcuts.
 * While a timeline preview is open, only navigation and view commands run.
 */

import {
  copyImage,
  exportDocument,
  openExport,
  openPdfExport,
  type CopyAs,
  type ExportKind,
} from './files';
import { openComparison } from './comparison';
import { encodeSource } from '../lib/source-hash';
import {
  go,
  homeUrl,
  newDiagramSource,
  openInPlayground,
  playgroundNote,
  setStartOpen,
  siteUrl,
  startUrl,
  workspace,
} from './launch';
import { toast } from './toast';
import {
  filesShown,
  focusLabelField,
  objectsOpen,
  propertiesOpen,
  confirmAction,
  openDialog,
  openQuickBuild,
  setCreatingFile,
  setFilesOpen,
  setObjectsOpen,
  setSavingExample,
  toggleRightTab,
  type RightTab,
  togglePanels,
} from './ui';
import { findNode, isGroup } from '../model/graph';
import { activeSession } from './active-session';
import {
  canvasCommands,
  checkedEnabled,
  hasSelection,
  runChecked,
  setLabelNamer,
  type Command,
} from './canvas-commands';

export type { Command };

// The Inspector belongs to the app shell, so the shell says how a new message gets its name.
setLabelNamer(() => propertiesOpen() && (focusLabelField(), true));

let fileInput:
  ((replaceImageId: string | null, accept: 'diagram' | 'image' | 'foreign') => void) | null = null;
/** Set by the app shell, which owns the hidden file inputs. */
export const setFilePicker = (fn: typeof fileInput) => (fileInput = fn);

function exportCommand(format: 'json') {
  if (activeSession().sculptInteracting()) {
    toast('Keep or cancel the preview before exporting the diagram.');
    return;
  }
  return exportDocument(format).catch(error =>
    toast(error instanceof Error ? error.message : String(error)),
  );
}

function openExportCommand(kind: ExportKind) {
  if (activeSession().sculptInteracting())
    toast('Keep or cancel the preview before exporting the diagram.');
  else openExport(kind);
}

function copyCommand(kind: CopyAs) {
  if (activeSession().sculptInteracting()) {
    toast('Keep or cancel the preview before copying the diagram.');
    return;
  }
  return copyImage(kind).catch(error =>
    toast(error instanceof Error ? error.message : String(error)),
  );
}

/** Show the files panel and put the cursor in its filter. */
function findFile() {
  setFilesOpen(true);
  requestAnimationFrame(() =>
    document.querySelector<HTMLInputElement>('.files-panel .panel-search input')?.select(),
  );
}

/**
 * A served folder names the new diagram in its files panel. The static site replaces the
 * browser copy; from an example there, a blank scratch copy opens instead, like the Playground's.
 */
async function newDiagram() {
  if (!activeSession().fileMode()) return activeSession().newDocument();
  if (workspace()) {
    setFilesOpen(true);
    setCreatingFile(true);
    return;
  }
  // `?new` makes this a page load even from a shared copy, whose URL differs only in the hash.
  // The time keeps each blank's stored edits apart (see `openExampleSession`).
  const hash = await encodeSource(newDiagramSource(''));
  location.assign(`${startUrl()}?new#${hash}&t=${Date.now()}`);
}

function openStart() {
  if (workspace()) void go(startUrl());
  else setStartOpen(true);
}

export const commands = {
  undo: canvasCommands.undo,
  redo: canvasCommands.redo,

  'add-node': canvasCommands['add-node'],
  'add-connected': canvasCommands['add-connected'],
  'quick-build': {
    hint: 'Type or paste an indented list and get connected shapes.',
    label: 'Build from a list…',
    keys: 'B',
    icon: 'layers',
    run: () => openQuickBuild(),
  },
  'insert-step': {
    label: 'Insert step',
    run: () => {
      const id = activeSession()
        .selectedIds()
        .find(id => activeSession().doc.graph.edges.some(e => e.id === id));
      if (id) activeSession().insertStep(id);
    },
  },
  duplicate: canvasCommands.duplicate,
  group: canvasCommands.group,
  ungroup: canvasCommands.ungroup,
  pin: canvasCommands.pin,
  'release-manual': {
    hint: 'Forget that shapes were moved by hand.',
    label: 'Clear manual markers',
    run: () => activeSession().clearManualMarkers(),
  },
  delete: canvasCommands.delete,
  'delete-deep': canvasCommands['delete-deep'],
  'align-left': {
    label: 'Align left',
    icon: 'align-left',
    enabled: hasSelection,
    run: () => activeSession().alignSelection('left'),
  },
  'align-top': {
    label: 'Align top',
    icon: 'align-top',
    enabled: hasSelection,
    run: () => activeSession().alignSelection('top'),
  },
  'align-center': {
    label: 'Align horizontal centers',
    icon: 'align-center',
    enabled: hasSelection,
    run: () => activeSession().alignSelection('center'),
  },
  'align-middle': {
    label: 'Align vertical centers',
    icon: 'align-middle',
    enabled: hasSelection,
    run: () => activeSession().alignSelection('middle'),
  },
  'distribute-x': {
    label: 'Distribute horizontally',
    icon: 'distribute-x',
    enabled: hasSelection,
    run: () => activeSession().alignSelection('distribute-x'),
  },
  'distribute-y': {
    label: 'Distribute vertically',
    icon: 'distribute-y',
    enabled: hasSelection,
    run: () => activeSession().alignSelection('distribute-y'),
  },
  'fit-container': { label: 'Fit contents', run: () => activeSession().fitSelectedContainer() },
  'reflow-group': {
    hint: 'Rearrange the contents of the selected container.',
    label: 'Reflow group',
    run: () => {
      const id = activeSession()
        .selectedIds()
        .find(id => isGroup(activeSession().doc, id));
      if (id) activeSession().reflowSelectedGroup(id);
    },
    enabled: () =>
      activeSession().fileMode() &&
      activeSession()
        .selectedIds()
        .some(id => isGroup(activeSession().doc, id)),
  },
  'collapse-selected': { label: 'Collapse or expand', run: () => activeSession().toggleCollapse() },
  'reverse-edge': { label: 'Reverse', run: () => activeSession().reverseSelectedEdge() },
  'insert-event-after': canvasCommands['insert-event-after'],
  'insert-event-before': canvasCommands['insert-event-before'],
  'move-event-up': canvasCommands['move-event-up'],
  'move-event-down': canvasCommands['move-event-down'],
  'reset-route': { label: 'Reset bends', run: () => activeSession().resetSelectedBends() },
  'mark-start': { label: 'Start here', run: () => activeSession().markSelectedAs('start') },
  'mark-end': { label: 'End here', run: () => activeSession().markSelectedAs('end') },

  layout: canvasCommands.layout,
  'layout-rebuild': canvasCommands['layout-rebuild'],
  'layout-preview': {
    label: 'Preview improvement',
    run: () => activeSession().runLabLayout('pass', true),
    blocked: () => activeSession().movesBlocked(),
    endsBrush: true,
  },
  'layout-accept': canvasCommands['layout-accept'],
  'layout-discard': canvasCommands['layout-discard'],
  'layout-menu': {
    hint: 'Lay out again, or choose a direction, a format and how connections run.',
    label: 'Arrange',
    keys: '⌥L',
    icon: 'layers',
    run: () => toggleRight('arrange'),
    endsBrush: true,
    duringTimeline: true,
  },
  'layout-checkpoint': {
    label: 'Capture checkpoint',
    run: () => activeSession().captureCheckpoint(),
  },
  'layout-restore': { label: 'Restore checkpoint', run: () => activeSession().restoreCheckpoint() },
  'compare-layouts': {
    hint: 'See other arrangements beside this one, then apply one.',
    label: 'Compare alternatives',
    keys: '⌥E',
    run: () => openComparison('layout'),
    blocked: () => activeSession().rebuildBlocked(),
    endsBrush: true,
  },
  'compare-routes': {
    hint: 'See other connection routes beside these, then apply one.',
    label: 'Compare connections',
    run: () => openComparison('routing'),
    blocked: () => activeSession().routesBlocked(),
    endsBrush: true,
  },
  reroute: canvasCommands.reroute,
  'auto-ports': canvasCommands['auto-ports'],

  'timeline-toggle': {
    hint: 'Step through arrangements from here to a tidy result and pick one.',
    label: 'Layout timeline',
    keys: '⌥T',
    icon: 'journey',
    run: () =>
      activeSession().timelineOpen()
        ? activeSession().closeTimeline()
        : activeSession().openTimeline(),
    blocked: () => activeSession().movesBlocked(),
    duringTimeline: true,
  },
  'timeline-reopen': {
    hint: 'Open the last layout timeline again.',
    label: 'Reopen last layout timeline',
    icon: 'journey',
    run: () => activeSession().reopenTimeline(),
    duringTimeline: true,
  },
  'timeline-save': {
    hint: 'Download the last layout timeline as a file.',
    label: 'Save layout timeline…',
    icon: 'download',
    run: () => activeSession().saveTimelineFile(),
    duringTimeline: true,
  },
  'brush-toggle': {
    hint: 'Paint over shapes to tidy only that part of the drawing.',
    label: 'Layout brush',
    keys: 'W',
    icon: 'brush',
    run: () => activeSession().toggleBrush(),
    blocked: () => activeSession().movesBlocked(),
    duringTimeline: true,
  },

  fit: canvasCommands.fit,
  'zoom-in': canvasCommands['zoom-in'],
  'zoom-out': canvasCommands['zoom-out'],
  'reset-camera': canvasCommands['reset-camera'],
  'toggle-objects': {
    hint: 'List every shape and container, with search.',
    label: 'Objects',
    keys: '[',
    icon: 'tree',
    run: () => setObjectsOpen(!objectsOpen()),
    duringTimeline: true,
  },
  'toggle-sidebar': {
    hint: 'Show or hide the list of diagrams and objects.',
    label: 'Sidebar',
    icon: 'panel-left',
    run: () => {
      if (filesShown()) setFilesOpen(false);
      else if (objectsOpen()) setObjectsOpen(false);
      else if (workspace()) setFilesOpen(true);
      else setObjectsOpen(true);
    },
    duringTimeline: true,
  },
  'toggle-files': {
    hint: 'List the diagrams in the open folder.',
    label: 'Diagrams in this folder',
    keys: 'F',
    icon: 'folder',
    run: () => setFilesOpen(!filesShown()),
    enabled: () => !!workspace(),
    duringTimeline: true,
  },
  'find-file': {
    hint: 'Jump to a diagram in the open folder.',
    label: 'Go to diagram…',
    keys: '⌘P',
    icon: 'search',
    run: findFile,
    enabled: () => !!workspace(),
    duringTimeline: true,
  },
  'toggle-inspector': {
    hint: 'Edit the selected shape or connection, or the diagram.',
    label: 'Inspector',
    keys: ']',
    icon: 'sliders',
    run: () => toggleRight('properties'),
    duringTimeline: true,
  },
  'toggle-source': {
    hint: 'Show and edit the .draft text beside the canvas.',
    label: 'Source',
    keys: '`',
    icon: 'code',
    run: () => toggleRight('source'),
    duringTimeline: true,
  },
  'toggle-panels': {
    hint: 'Give the canvas the whole window, or bring the panels back.',
    label: 'Hide or restore panels',
    keys: '\\',
    run: togglePanels,
    duringTimeline: true,
  },
  palette: {
    label: 'Find a command',
    keys: '⌘K',
    icon: 'search',
    hint: 'Search every command, diagram and example by name.',
    run: () => openDialog('palette'),
    duringTimeline: true,
  },
  help: {
    hint: 'See every shortcut.',
    label: 'Keyboard shortcuts',
    keys: '?',
    icon: 'help',
    run: () => openDialog('help'),
    duringTimeline: true,
  },

  start: {
    hint: 'See new, recent and example diagrams.',
    label: 'Start screen…',
    icon: 'folder',
    // With a served folder the start page lists its files; otherwise it opens over the editor.
    run: openStart,
    duringTimeline: true,
  },
  'new-diagram': {
    label: 'New diagram',
    icon: 'plus',
    run: newDiagram,
    hint: 'Start an empty diagram.',
  },
  open: {
    hint: 'Open a saved diagram, SVG or image.',
    label: 'Open diagram…',
    keys: '⌘O',
    icon: 'folder',
    run: () => fileInput?.(null, 'diagram'),
  },
  'save-example': {
    hint: 'Write this scratch copy to a new file in the folder.',
    label: 'Save as file…',
    icon: 'file',
    enabled: () => activeSession().exampleMode() && !!workspace(),
    run: () => setSavingExample(true),
  },
  'import-diagram': {
    hint: 'Turn a Mermaid, DOT or D2 file into a diagram.',
    label: 'Import text diagram…',
    icon: 'folder',
    run: () => fileInput?.(null, 'foreign'),
  },
  'insert-image': {
    hint: 'Place a picture on the canvas.',
    label: 'Insert image…',
    icon: 'image',
    run: () => fileInput?.(null, 'image'),
  },
  'replace-image': {
    label: 'Replace image',
    run: () =>
      fileInput?.(
        activeSession()
          .selectedIds()
          .find(id => findNode(activeSession().doc, id)) ?? null,
        'image',
      ),
  },
  'export-json': {
    hint: 'Save the diagram to a file on this computer.',
    label: 'Save diagram',
    keys: '⌘S',
    icon: 'download',
    run: () => exportCommand('json'),
  },
  'export-folder': {
    hint: 'Put every diagram in the folder into one PDF.',
    label: 'Export folder as PDF…',
    icon: 'file',
    enabled: () => !!workspace()?.files.length,
    run: () => openPdfExport((workspace()?.files ?? []).map(f => f.path)),
  },
  'export-png': {
    hint: 'Save a picture, with size and background options.',
    label: 'Export PNG…',
    icon: 'image',
    run: () => openExportCommand('png'),
  },
  'export-svg': {
    hint: 'Save a scalable drawing that opens again as a diagram.',
    label: 'Export SVG…',
    icon: 'export',
    run: () => openExportCommand('svg'),
  },
  'export-pdf': {
    hint: 'Save this diagram as a PDF page.',
    label: 'Export PDF…',
    icon: 'file',
    run: () => openExportCommand('pdf'),
  },
  'copy-image': {
    hint: 'Copy the diagram or selection to the clipboard as a picture.',
    label: 'Copy image',
    keys: '⇧⌘C',
    icon: 'copy',
    run: () => copyCommand('image'),
  },
  'copy-svg': { label: 'SVG markup', icon: 'code', run: () => copyCommand('svg') },
  'copy-source': { label: 'draftably source', icon: 'file', run: () => copyCommand('source') },
  'copy-link': { label: 'Link to this diagram', icon: 'globe', run: () => copyCommand('link') },
  theme: {
    hint: 'Switch the editor between light and dark. The diagram keeps its theme.',
    label: 'Light or dark editor',
    icon: 'sun',
    run: () => activeSession().toggleTheme(),
  },
  home: {
    hint: 'Go to the start of this folder or to the draftably site.',
    label: 'Home',
    icon: 'home',
    run: () => void go(homeUrl()),
    duringTimeline: true,
  },
  docs: {
    hint: 'Open the draftably docs in a new tab.',
    label: 'Docs',
    icon: 'globe',
    // A new tab, so the diagram here stays as it is.
    run: () => window.open(siteUrl('docs'), '_blank', 'noopener'),
    duringTimeline: true,
  },
  'open-playground': {
    hint: 'Edit a copy of this source next to its drawing.',
    label: 'Open in Playground',
    icon: 'code',
    // Only a file or an example has source to carry.
    enabled: () => activeSession().fileMode(),
    run: () =>
      confirmAction({
        title: 'Open in the Playground?',
        message: playgroundNote(),
        confirmLabel: 'Open Playground',
        onConfirm: () => void openInPlayground(),
      }),
  },
} satisfies Record<string, Command>;

export type CommandId = keyof typeof commands;

/** Open or close a right-panel tab, keeping a diagram that was shown whole in view. */
function toggleRight(tab: RightTab) {
  const whole = !activeSession().diagramClipped();
  toggleRightTab(tab);
  // The canvas takes its new size on the next frame.
  if (whole)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => activeSession().diagramClipped() && activeSession().fitView()),
    );
}

/**
 * Tools whose results a diagram file cannot store yet. Rebuilds, Compare and routing are saved as
 * layout recipes and `routing` lines; passes, timeline steps and brush strokes as `stay`
 * positions. Checkpoints are not needed: undo steps through the file's versions.
 */
const FILE_UNSUPPORTED = new Set<string>([
  'layout-checkpoint',
  'layout-restore',
  'reset-route',
  'mark-start',
  'mark-end',
  'fit-container',
  'insert-image',
  'replace-image',
  'open',
]);
const unavailableInFile = (id: string) => activeSession().fileMode() && FILE_UNSUPPORTED.has(id);

export function runCommand(id: CommandId) {
  if (unavailableInFile(id)) {
    toast('Not available while editing a diagram file. Its results cannot be saved to the file.');
    return;
  }
  runChecked(id, commands[id]);
}

export const commandEnabled = (id: CommandId) =>
  !unavailableInFile(id) && checkedEnabled(commands[id]);
