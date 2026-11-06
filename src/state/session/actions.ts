/**
 * Editor operations behind the toolbar, menus, inspector and keyboard shortcuts.
 * Each one is a single undoable step.
 */
import { batch, createSignal } from 'solid-js';
import {
  groupShadeFor,
  isBuiltInFamily,
  NODE_SHADE,
  resolveAppearance,
  shadesOf,
  type AppearanceOverrides,
  type Shade,
  type ThemeId,
} from '../../model/appearance';
import { normalize } from '../../model/document';
import * as edits from '../../model/edits';
import {
  descendants,
  findEdge,
  findGroup,
  findNode,
  frameRect,
  isCollapsed,
  isEdge,
  isGroup,
  selectionRoots,
} from '../../model/graph';
import { loadSample } from '../../model/samples';
import type { Diagram, IntentPlacement, IntentRole, Point, Rect, Side } from '../../model/types';
import { type Tool } from './editor';
import { parseTextId, setTextValue, TEXT_NAMES, textId, textValue } from './canvas-text';
import { toast } from '../toast';
import type { ConfirmRequest } from '.';
import type { EditorPart } from './editor';
import type { DocumentPart } from './document';
import type { ScenePart } from './scene';
import type { LayoutPart } from './layout';

/** Inline-edit ids of the frame's title and subtitle; never valid object ids. */
export const HEADING_EDIT = { title: textId('title'), subtitle: textId('subtitle') } as const;

export function createActions(s: EditorPart & DocumentPart & ScenePart & LayoutPart) {
  // --- Tools -----------------------------------------------------------------------------------

  /** Lets the brush and timeline intercept tool changes. Returns true when handled. */
  let toolInterceptor: (tool: Tool) => boolean = () => false;
  const setToolInterceptor = (fn: (tool: Tool) => boolean) => (toolInterceptor = fn);

  function setTool(next: Tool) {
    if (toolInterceptor(next)) return;
    finishInlineEdit(true);
    batch(() => {
      s.setToolSignal(next);
      const only = s.singleSelection();
      s.setConnectFrom(
        next === 'connect' && only && findNode(s.doc, only) ? { id: only, side: 'auto' } : null,
      );
    });
    s.focusCanvas();
  }

  // --- Inline label editing --------------------------------------------------------------------

  const [inlineDraft, setInlineDraft] = createSignal('');

  s.onSourceIdMap(mapId => {
    const id = s.inlineEditId();
    if (id) s.setInlineEditId(mapId(id));
  });

  function startInlineEdit(id: string) {
    if (s.readOnly()) return;
    const text = parseTextId(id) && textValue(s.doc, id);
    if (text !== undefined) {
      finishInlineEdit(true);
      batch(() => {
        s.setConnectFrom(null);
        setInlineDraft(text);
        s.setInlineEditId(id);
      });
      return;
    }
    const entity = findNode(s.doc, id) ?? findGroup(s.doc, id) ?? findEdge(s.doc, id);
    if (!entity) return;
    finishInlineEdit(true);
    batch(() => {
      s.setConnectFrom(null);
      setInlineDraft('label' in entity ? entity.label : entity.title);
      s.setInlineEditId(id);
    });
  }

  function finishInlineEdit(save = true) {
    const id = s.inlineEditId();
    if (!id) return;
    s.setInlineEditId(null);
    if (!save) return;
    const value = inlineDraft().trim(),
      text = parseTextId(id);
    if (text) {
      if (textValue(s.doc, id) !== value)
        s.transact(`Edit ${TEXT_NAMES[text.kind]}`, d => setTextValue(d, id, value));
      // An emptied note or legend row is gone, and later ones move up an index.
      if (!value) s.clearSelection();
      return;
    }
    const edge = findEdge(s.doc, id);
    if (edge) {
      if (edge.label !== value) s.transact('Edit label', d => edits.setEdgeLabel(d, id, value));
      return;
    }
    const object = findNode(s.doc, id) ?? findGroup(s.doc, id);
    if (object && object.title !== (value || 'Untitled'))
      s.transact('Edit label', d => edits.setTitle(d, id, value));
  }

  // A registered handler, not a reactive read.
  // eslint-disable-next-line solid/reactivity
  s.onBeforeEdit(() => {
    // Commit a pending label before any other edit so it lands in its own undo step.
    if (s.inlineEditId()) finishInlineEdit(true);
  });

  // --- Creating objects ------------------------------------------------------------------------

  function addNode(partial: edits.NewNode = {}, at: Point = s.canvasCenter(), edit = false) {
    let id = '';
    s.transact('Add shape', d => {
      id = edits.addNode(d, partial, at);
    });
    s.setSelection([id]);
    if (edit) startInlineEdit(id);
    return id;
  }

  function addEdge(partial: edits.NewEdge) {
    let id = '';
    s.transact('Add connection', d => {
      id = edits.addEdge(d, partial);
    });
    s.setSelection([id]);
    return id;
  }

  /** Finish a connection started with the Connect tool or a port drag. */
  function completeConnection(targetId: string, side: Side | 'auto' = 'auto') {
    const from = s.connectFrom();
    if (!from || !findNode(s.doc, targetId)) return;
    s.setConnectFrom(null);
    addEdge({ from: from.id, to: targetId, fromSide: from.side, toSide: side });
    // Connect stays active; the inspector shows the target.
    s.setSelection([targetId]);
    s.focusCanvas();
  }

  /**
   * Add a connected shape next to the selection (Tab, Alt+arrow, quick-add buttons).
   * With a connection selected, split it instead.
   */
  function quickExtend({
    side = null,
    sibling = false,
    at = null,
    from = null,
  }: { side?: Side | null; sibling?: boolean; at?: Point | null; from?: string | null } = {}) {
    s.prepareForEdit();
    const ids = s.selectedIds();
    if (ids[0] && isEdge(s.doc, ids[0]) && !from && !sibling && !at) return insertStep(ids[0]);
    const source = from || ids.find(id => findNode(s.doc, id)) || null,
      container = ids.find(id => findGroup(s.doc, id));
    let parentId: string | null | undefined;
    let target = at;
    if (target) {
      parentId =
        edits.dropTarget(s.doc, '', { x: target.x - 82, y: target.y - 28, w: 164, h: 56 })?.id ||
        null;
    } else if (!source && container) {
      parentId = container;
      const p = s.doc.layout.nodes[container],
        pad = edits.containerPadding(s.doc, container);
      target = { x: p.x + pad + 82, y: p.y + pad + 56 };
    }
    let id = '';
    s.transact(sibling ? 'Add sibling branch' : 'Add connected shape', d => {
      id = edits.addConnectedNode(
        d,
        {
          from: sibling ? null : source,
          siblingOf: sibling ? source : null,
          side,
          at: target,
          parentId,
          title: sibling ? 'Another branch' : 'Next step',
        },
        s.canvasCenter(),
      );
    });
    batch(() => {
      s.setSelection([id]);
      s.setConnectFrom(null);
    });
    s.revealObject(id);
    startInlineEdit(id);
    return id;
  }

  /** Insert a new shape in the middle of a connection. */
  function insertStep(edgeId: string, at: Point | null = null) {
    if (!findEdge(s.doc, edgeId)) return;
    let id: string | undefined;
    s.transact('Insert connected step', d => {
      id = edits.insertStep(d, edgeId, s.routesById().get(edgeId)?.points, at);
    });
    if (!id) return;
    s.setSelection([id]);
    s.revealObject(id);
    startInlineEdit(id);
    return id;
  }

  function buildFromList(
    lines: string[],
    options: {
      mode?: edits.BuildMode;
      title?: string;
      source?: string | null;
      parentId?: string | null;
    } = {},
  ) {
    let ids: string[] = [];
    const columns = Math.max(2, Math.min(5, Math.floor((s.stageSize().width - 100) / 212)));
    s.transact('Build ' + lines.length + ' shapes', d => {
      ids = edits.buildFromList(d, lines, { ...options, origin: s.canvasCenter(), columns });
    });
    s.setSelection(ids);
    s.fitView();
    const mode = options.mode ?? 'chain';
    toast(
      `${lines.length} shapes created · ${mode === 'none' ? 'no connections' : mode === 'chain' ? 'connected flow' : 'branches'} · one undo`,
    );
    return ids;
  }

  function wrapSelection() {
    let id = '';
    s.transact('Create container', d => {
      id = edits.wrapInContainer(d, selectionRoots(d, s.selection()), s.canvasCenter());
    });
    s.setSelection([id]);
    startInlineEdit(id);
    return id;
  }

  function drawContainer(rect: { x: number; y: number; w: number; h: number }) {
    let id = '';
    s.transact('Create container', d => {
      id = edits.drawContainer(d, rect);
    });
    s.setSelection([id]);
    startInlineEdit(id);
  }

  // --- Changing the selection ------------------------------------------------------------------

  function deleteSelection(deep = false) {
    if (!s.selection().size) return;
    const ids = s.selectedIds();
    s.transact(deep ? 'Delete with contents' : 'Delete selection', d =>
      edits.deleteObjects(d, ids, deep),
    );
    batch(() => {
      s.clearSelection();
      s.setConnectFrom(null);
    });
  }

  function ungroupSelection() {
    const ids = s.selectedIds().filter(id => isGroup(s.doc, id));
    if (!ids.length) return;
    s.transact('Ungroup', d => edits.ungroup(d, ids));
    s.clearSelection();
  }

  function togglePin() {
    const roots = selectionRoots(s.doc, s.selection());
    if (!roots.length) return;
    const value = !roots.every(id => s.doc.layout.nodes[id].pinned);
    s.transact(value ? 'Pin objects' : 'Unpin objects', d => {
      for (const id of roots) d.layout.nodes[id].pinned = value;
    });
  }

  function clearManualMarkers() {
    const roots = selectionRoots(s.doc, s.selection());
    s.transact('Clear manual markers', d => {
      for (const id of roots) d.layout.nodes[id].manual = false;
    });
  }

  function alignSelection(kind: edits.AlignKind) {
    const roots = selectionRoots(s.doc, s.selection());
    if (roots.length < 2) {
      toast('Select two or more objects.');
      return;
    }
    s.transact('Align objects', d => edits.alignObjects(d, roots, kind));
  }

  function nudgeSelection(dx: number, dy: number) {
    const roots = selectionRoots(s.doc, s.selection());
    if (roots.length) s.transact('Nudge', d => edits.nudge(d, roots, dx, dy));
    return roots.length > 0;
  }

  function setColor(color: Diagram['styles'][string]['color']) {
    const ids = s.selectedIds().filter(id => findNode(s.doc, id) || findGroup(s.doc, id));
    const look = resolveAppearance(s.doc.appearance);
    s.transact('Change color', d => {
      for (const id of ids) {
        edits.setStyle(d, id, { color });
        // A file-defined family may not have the current shade; use its closest one.
        const style = d.styles[id],
          shade = style.shade ?? (findGroup(d, id) ? groupShadeFor(look.theme) : NODE_SHADE),
          available = color === 'auto' ? [] : shadesOf(look, color);
        if (available.length && !available.includes(shade))
          style.shade = available.reduce((a, b) =>
            Math.abs(b - shade) < Math.abs(a - shade) ? b : a,
          );
      }
    });
  }

  /**
   * Switch the diagram to a preset theme in one undoable step. Overrides of the old preset are
   * cleared; the file's own color families stay, so objects that use them keep their colors.
   */
  function chooseTheme(theme: ThemeId) {
    s.transact('Change theme', d => {
      d.appearance = {
        ...d.appearance,
        theme,
        overrides: {},
        colors: d.appearance.colors.filter(c => !isBuiltInFamily(c.family)),
      };
    });
  }

  /** Change diagram-wide appearance values; `undefined` returns a value to the theme's default. */
  function setAppearanceOverrides(patch: Partial<AppearanceOverrides>, label = 'Change padding') {
    s.transact(label, d => {
      const next = { ...d.appearance.overrides, ...patch };
      for (const key of Object.keys(next) as Array<keyof AppearanceOverrides>)
        if (next[key] === undefined) delete next[key];
      d.appearance.overrides = next;
    });
  }

  /** Set the shade of the selection; `undefined` returns to the default shade. */
  function setShade(shade: Shade | undefined) {
    const ids = s.selectedIds().filter(id => findNode(s.doc, id) || findGroup(s.doc, id));
    s.transact('Change shade', d => {
      for (const id of ids) {
        const style = (d.styles[id] ||= { shape: 'box', color: 'auto', icon: '' });
        if (shade === undefined) delete style.shade;
        else style.shade = shade;
      }
    });
  }

  function fitSelectedContainer() {
    const id = selectionRoots(s.doc, s.selection()).find(id => isGroup(s.doc, id));
    if (id)
      s.transact('Fit container', d => {
        edits.fitContainer(d, id);
        d.layout.containers[id].manualSize = true;
      });
  }

  function toggleCollapse(
    id = selectionRoots(s.doc, s.selection()).find(id => isGroup(s.doc, id)),
  ) {
    if (!id || !isGroup(s.doc, id)) return;
    const before = frameRect(s.doc, s.geometry, id);
    // A file never stores which containers are collapsed: there it is a view, like the camera,
    // and needs no translation, recompile or save.
    // The scene draws quick routes and has the worker route it in full.
    if (s.editsGoToFile()) s.mutate(d => edits.toggleCollapsed(d, id));
    else s.transact('Toggle container', d => edits.toggleCollapsed(d, id));
    animateToggle(id, before);
  }

  /** Grow or shrink the frame from its old size, and fade in what an expand reveals. */
  function animateToggle(id: string, before: Rect) {
    const svg = s.canvasElement();
    if (!svg || s.reducedMotion()) return;
    const after = frameRect(s.doc, s.geometry, id),
      expanded = !isCollapsed(s.doc, id),
      inside = new Set(descendants(s.doc, id));
    requestAnimationFrame(() => {
      const timing = { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
      svg.querySelector(`g.group[data-id="${CSS.escape(id)}"] > .group-bg`)?.animate(
        [
          { width: `${before.w}px`, height: `${before.h}px` },
          { width: `${after.w}px`, height: `${after.h}px` },
        ],
        timing,
      );
      if (!expanded) return;
      for (const el of svg.querySelectorAll<SVGGElement>('g[data-kind][data-id]')) {
        const edge = findEdge(s.doc, el.dataset.id!);
        const revealed = edge
          ? inside.has(edge.from) || inside.has(edge.to)
          : inside.has(el.dataset.id!);
        if (revealed) el.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing, delay: 60 });
      }
    });
  }

  function reverseSelectedEdge() {
    const id = s.selectedIds().find(id => isEdge(s.doc, id));
    if (id) s.transact('Reverse connection', d => edits.reverseEdge(d, id));
  }

  function resetSelectedBends() {
    const id = s.selectedIds().find(id => isEdge(s.doc, id));
    if (id)
      s.transact('Reset connection bends', d =>
        edits.setEdgeLayout(d, id, { waypoints: undefined }),
      );
  }

  function setLayoutIntent(role: IntentRole, id: string | null, placement?: IntentPlacement) {
    try {
      s.transact('Set ' + role + ' preference', d => edits.setIntent(d, role, id, placement));
      toast(
        id
          ? 'Layout preference saved. Tidy or compare to arrange it.'
          : 'Cleared ' + role + ' preference',
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  }

  function markSelectedAs(role: IntentRole) {
    const id = s.selectedIds().find(id => findNode(s.doc, id));
    if (id) setLayoutIntent(role, id);
    else toast('Select a shape first.');
  }

  function addWaypointAt(edgeId: string, point?: Point) {
    const route = s.routesById().get(edgeId);
    if (!route) return;
    const current = s.doc.layout.edges[edgeId]?.waypoints || [];
    if (current.length >= 40) {
      toast('Use at most 40 waypoints per edge.');
      return;
    }
    const first = route.points[0],
      last = route.points.at(-1)!;
    const p = point || {
      x: route.label?.x ?? (first.x + last.x) / 2,
      y: (route.label?.y ?? (first.y + last.y) / 2) + 38,
    };
    if (edits.bendInsideShape(s.doc, p)) {
      toast('Place a waypoint outside a node.');
      return;
    }
    s.transact('Add waypoint', d => edits.addWaypoint(d, edgeId, p));
    s.setSelection([edgeId]);
  }

  function removeWaypoint(edgeId: string, index: number) {
    s.transact('Remove bend', d => edits.removeWaypoint(d, edgeId, index));
  }

  /** Recompute connections without moving shapes. With `auto`, release fixed port sides first. */
  function reroute({ auto = false } = {}) {
    finishInlineEdit(true);
    if (auto) {
      const edgesSelected = s.selectedIds().filter(id => isEdge(s.doc, id));
      const ids = edgesSelected.length
        ? edgesSelected
        : s.doc.graph.edges.filter(e => s.isSelected(e.from) || s.isSelected(e.to)).map(e => e.id);
      if (!ids.length) {
        toast('Select connections or shapes to release their fixed ports.');
        return;
      }
      s.transact('Use automatic ports', d => edits.useAutomaticPorts(d, ids));
    }
    s.resetRoutes();
    s.setAdoptedRoutes(null);
    // Reading the report forces the routes to be recomputed now.
    const r = s.routingReport();
    toast(
      `Routes refreshed · ${r.crossings} crossings · ${r.lanePairs} close lane pairs · ${r.blocked} obstructed · shapes unchanged`,
    );
  }

  function toggleTheme() {
    s.transact('Change theme', d => {
      d.theme = d.theme === 'light' ? 'dark' : 'light';
    });
  }

  // --- Clipboard -------------------------------------------------------------------------------

  let clipboard: edits.ClipboardFragment | null = null;

  function copySelection() {
    if (!s.selection().size) return null;
    clipboard = edits.copyFragment(s.doc, s.selection());
    toast(
      `Copied ${clipboard.nodes.length + clipboard.groups.length + clipboard.edges.length} objects`,
    );
    return clipboard;
  }

  const hasClipboard = () => !!clipboard;

  function pasteFragment(part: edits.ClipboardFragment | null = clipboard) {
    if (!part || !edits.isClipboardFragment(part)) {
      toast('Copy some objects first, or import JSON.');
      return;
    }
    const result = edits.pasteFragment(s.doc, part);
    s.transact('Paste objects', d => Object.assign(d, result.doc));
    s.setSelection(result.selected);
  }

  function duplicateSelection() {
    if (!s.selection().size) return;
    pasteFragment(edits.copyFragment(s.doc, s.selection()));
    toast('Duplicated selection');
  }

  // --- Whole documents -------------------------------------------------------------------------

  /** Replace the diagram as one undo step. */
  function openDocument(input: unknown, { fit = true, label = 'Open diagram' } = {}) {
    s.discardPreview();
    s.prepareForEdit();
    const valid = normalize(input);
    const camera = { ...s.doc.camera };
    s.transact(label, d => {
      Object.assign(d, valid);
      if (!fit) d.camera = camera;
    });
    batch(() => {
      s.clearSelection();
      s.setConnectFrom(null);
      s.setToolSignal('select');
      s.resetRoutes();
    });
    if (fit) requestAnimationFrame(() => s.fitView());
    return valid;
  }

  s.setDocumentOpener((d, label) => openDocument(d, { fit: false, label }));

  const confirm = (request: ConfirmRequest) =>
    s.options.confirm ? s.options.confirm(request) : request.onConfirm();

  function newDocument() {
    confirm({
      title: 'New diagram?',
      message:
        'The current diagram is saved in this browser. Starting a new diagram replaces it. Undo can restore it until you close this page.',
      confirmLabel: 'New diagram',
      onConfirm: () => openDocument(edits.emptyDiagram(), { label: 'New diagram' }),
    });
  }

  function openSample(id: string) {
    const load = () => openDocument(loadSample(id), { label: 'Load example' });
    if (!s.doc.graph.nodes.length && !s.doc.graph.groups.length) return load();
    confirm({
      title: 'Open example?',
      message:
        'This replaces the current diagram. Undo restores it. Save a copy first to keep both.',
      confirmLabel: 'Open example',
      onConfirm: load,
    });
  }
  return {
    inlineDraft,
    setInlineDraft,
    setToolInterceptor,
    setTool,
    startInlineEdit,
    finishInlineEdit,
    addNode,
    addEdge,
    completeConnection,
    quickExtend,
    insertStep,
    buildFromList,
    wrapSelection,
    drawContainer,
    deleteSelection,
    ungroupSelection,
    togglePin,
    clearManualMarkers,
    alignSelection,
    nudgeSelection,
    setColor,
    chooseTheme,
    setAppearanceOverrides,
    setShade,
    fitSelectedContainer,
    toggleCollapse,
    reverseSelectedEdge,
    resetSelectedBends,
    setLayoutIntent,
    markSelectedAs,
    addWaypointAt,
    removeWaypoint,
    reroute,
    toggleTheme,
    copySelection,
    hasClipboard,
    pasteFragment,
    duplicateSelection,
    openDocument,
    newDocument,
    openSample,
  };
}

export type ActionsPart = ReturnType<typeof createActions>;
