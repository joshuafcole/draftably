/**
 * Source edits for the editor's layout tools: choosing an engine for a scope (Layout options,
 * Rebuild, Compare) and choosing router settings. Results that depend on an earlier drawing
 * (passes, timeline steps, brush strokes) are written as arrangements instead; see
 * `writeArrangement` in `translate.ts`.
 */
import { LayoutLab } from '../engines/layout-engine';
import { RouteLab } from '../engines/routing-engine';
import type { Diagram, LayoutSettings, Rect, RoutingSettings } from '../model/types';
import { layoutView, type Scene, type SceneObject } from './compile';
import { contentOrigin, GROUP_INSET } from './frame';
import { UnsupportedEdit } from './translate';
import { groupHeaderFor } from '../model/labels';
import {
  addRefinement,
  clearPosition,
  getAttr,
  num,
  setAttr,
  insertAfter,
  layoutStatement,
  removeWhere,
  statement,
  statements,
} from './source-edits';
import {
  bare,
  ENGINE_PARAMS,
  FITS,
  printStatement,
  readSource,
  ENGINES,
  paramAttr,
  ROUTING_PARAMS,
  type Fit,
  type SourceDoc,
  type Statement,
  type Word,
} from './syntax';

export class UnstorableLayout extends Error {}

/** Settings every engine reads, besides its own controls. */
const SHARED: Array<keyof LayoutSettings> = ['nodeGap', 'aspect'];

const value = (v: unknown): Word => bare(String(v));

/** The `layout` attributes for engine settings: the engine's own controls that differ from the defaults. */
export function engineAttrs(settings: LayoutSettings): Array<[string, Word]> {
  const algorithm = LayoutLab.algorithms.find(a => a.id === settings.algorithm);
  if (!algorithm || !ENGINES.includes(settings.algorithm as never))
    throw new UnstorableLayout(
      `${algorithm?.name ?? settings.algorithm} repairs the current drawing and cannot be saved as a layout recipe.`,
    );
  const attrs: Array<[string, Word]> = [['engine', bare(settings.algorithm)]];
  // `auto` already reads left to right in the compiler's landscape render context.
  if (settings.direction === 'DOWN') attrs.push(['direction', bare('down')]);
  const keys = [...algorithm.controls, ...SHARED] as Array<keyof LayoutSettings>;
  for (const key of keys) {
    const attr = paramAttr(ENGINE_PARAMS, key),
      v = settings[key];
    if (!attr || v === LayoutLab.defaults[key] || v === '') continue;
    // `canvas` depends on the window, which a file must not.
    if (key === 'aspect' && v === 'canvas') continue;
    attrs.push([attr, value(v)]);
  }
  return attrs;
}

/** The `layout` line a scope would get for these settings, or the reason it cannot. */
export function recipeText(scope: string, settings: LayoutSettings): string {
  try {
    return printStatement(statement('layout', [bare(scope)], engineAttrs(settings)));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The scope's current `layout` line in `source`, or null when it uses the default recipe. */
export function currentRecipe(source: string, scope: string): string | null {
  const s = layoutStatement(readSource(source), scope);
  return s ? printStatement({ ...s, comment: undefined }) : null;
}

/** What a scope's `layout` line says about the drawing, as the Arrange panel shows it. */
export interface LayoutShape {
  /** The built-in recipe, or the engine when the line names one. */
  recipe: string;
  engine: boolean;
  direction: 'auto' | 'right' | 'down';
  fit: Fit | null;
  gap: number | null;
  fold: 'auto' | 'never';
}

export type ShapeChange = Partial<Pick<LayoutShape, 'direction' | 'fit' | 'gap' | 'fold'>> & {
  /** Drop an engine for the scope's built-in recipe, keeping what the author said of the result. */
  builtin?: boolean;
};

const AXIS_RECIPES: Record<string, 'right' | 'down'> = { row: 'right', column: 'down' };

/** Read a scope's layout line. A scope without one uses the built-in recipe. */
export function layoutShape(source: string, scope: string): LayoutShape {
  const s = layoutStatement(readSource(source), scope),
    engine = s && getAttr(s, 'engine')?.value,
    recipe = engine ?? s?.args[1]?.value ?? (scope === 'root' ? 'flow' : 'column'),
    fit = s && getAttr(s, 'fit')?.value,
    gap = s && getAttr(s, 'gap')?.value;
  return {
    recipe,
    engine: !!engine,
    direction:
      AXIS_RECIPES[recipe] ??
      ((s && getAttr(s, 'direction')?.value) as LayoutShape['direction'] | undefined) ??
      'auto',
    fit: fit && fit in FITS ? (fit as Fit) : null,
    gap: gap ? Number(gap) : null,
    fold: s && getAttr(s, 'fold')?.value === 'never' ? 'never' : 'auto',
  };
}

/**
 * Change what a scope's `layout` line says, keeping its recipe or engine. A `row` or `column`
 * states its direction by name, so it swaps with the other. Soft refinements inside the scope are
 * removed so the new shape shows; the count is returned. With no change, that is all it does.
 */
export function setLayoutShape(
  source: SourceDoc,
  scene: Scene,
  scope: string,
  change: ShapeChange,
): number {
  if (change.builtin) useBuiltIn(source, scope);
  const line = layoutLine(source, scope);
  const axis = AXIS_RECIPES[line.args[1]?.value ?? ''];
  if (change.direction && axis && change.direction !== 'auto')
    line.args[1] = bare(change.direction === 'right' ? 'row' : 'column');
  else if (change.direction)
    setAttr(line, 'direction', change.direction === 'auto' ? undefined : bare(change.direction));
  if ('fit' in change) setAttr(line, 'fit', change.fit ? bare(change.fit) : undefined);
  if (change.gap !== undefined) setAttr(line, 'gap', change.gap ? value(change.gap) : undefined);
  if (change.fold) setAttr(line, 'fold', change.fold === 'never' ? bare('never') : undefined);
  return removeRefinements(source, scene, scope);
}

/** Replace an engine line with the built-in recipe. A root recipe keeps a stated direction. */
function useBuiltIn(source: SourceDoc, scope: string) {
  const line = layoutStatement(source, scope);
  if (!line || !getAttr(line, 'engine')) return;
  const keys = [...(scope === 'root' ? ['direction'] : []), 'fit', 'min-width', 'min-height'];
  const kept = keys.flatMap((key): Array<[string, Word]> => {
    const attr = getAttr(line, key);
    return attr ? [[key, attr]] : [];
  });
  const next = statement('layout', [bare(scope), bare(scope === 'root' ? 'flow' : 'column')], kept);
  next.comment = line.comment;
  source.lines[source.lines.indexOf(line)] = next;
}

/** A scope's `layout` line, added with the built-in recipe when it has none. */
function layoutLine(source: SourceDoc, scope: string) {
  const existing = layoutStatement(source, scope);
  if (existing) return existing;
  const line = statement('layout', [bare(scope), bare(scope === 'root' ? 'flow' : 'column')]);
  placeLayout(source, line);
  return line;
}

function placeLayout(source: SourceDoc, line: Statement) {
  if (statements(source).some(s => s.command === 'layout'))
    insertAfter(source, line, s => s.command === 'layout');
  else insertAfter(source, line, s => s.command === 'edge' || s.command === 'node');
}

/** Ids inside a scope's subtree (not the scope itself). */
function inside(scene: Scene, scope: string) {
  return new Set(
    scene.objects
      .filter(o => {
        for (let p = o.parent; ; p = scene.byId.get(p)!.parent) {
          if (p === scope) return true;
          if (p === 'root') return false;
        }
      })
      .map(o => o.id),
  );
}

/** Remove soft position refinements in a scope, so its arrangement shows. Returns how many. */
function removeRefinements(source: SourceDoc, scene: Scene, scope: string) {
  const ids = scope === 'root' ? new Set(scene.objects.map(o => o.id)) : inside(scene, scope);
  const before = source.lines.length;
  removeWhere(source, s => {
    if (['near', 'nudge', 'stay'].includes(s.command)) return ids.has(s.args[0]?.value);
    if (s.command === 'align')
      return getAttr(s, 'strength')?.value !== 'required' && ids.has(s.args[1]?.value);
    return false;
  });
  return before - source.lines.length;
}

/**
 * Arrange `scope` with the engine in `settings`. Its `layout` line is replaced, keeping what the
 * author said about the result: `fit`, `min-width`, `min-height` and `direction`, unless
 * `direction` asks for another. Soft position refinements inside it are removed so the engine's
 * arrangement shows. Pins, sizes and nested `layout` lines stay. Returns the number of
 * refinements removed.
 */
export function setLayoutRecipe(
  source: SourceDoc,
  scene: Scene,
  scope: string,
  settings: LayoutSettings,
  direction?: 'right' | 'down',
): number {
  const existing = layoutStatement(source, scope);
  const reads = direction ?? (existing && getAttr(existing, 'direction'));
  const attrs = engineAttrs(settings).filter(([key]) => !reads || key !== 'direction');
  if (reads) attrs.splice(1, 0, ['direction', typeof reads === 'string' ? bare(reads) : reads]);
  for (const key of ['fit', 'min-width', 'min-height']) {
    const kept = existing && getAttr(existing, key);
    if (kept) attrs.push([key, kept]);
  }
  const next = statement('layout', [bare(scope)], attrs);
  if (existing) {
    next.comment = existing.comment;
    source.lines[source.lines.indexOf(existing)] = next;
  } else placeLayout(source, next);
  return removeRefinements(source, scene, scope);
}

/** The `routing` statement for router settings, or null when they are all defaults. */
export function routingStatement(routing: RoutingSettings): Statement | null {
  const attrs: Array<[string, Word]> = [];
  for (const [attr, p] of Object.entries(ROUTING_PARAMS)) {
    const v = routing[p.key];
    if (v !== RouteLab.defaults[p.key]) attrs.push([attr, value(v)]);
  }
  return attrs.length ? statement('routing', [], attrs) : null;
}

/** Replace the file's router settings. Defaults are left out; all defaults removes the line. */
export function setRouting(source: SourceDoc, routing: RoutingSettings) {
  const next = routingStatement(routing),
    existing = statements(source).find(s => s.command === 'routing');
  if (existing && next) {
    next.comment = existing.comment;
    source.lines[source.lines.indexOf(existing)] = next;
  } else if (existing) removeWhere(source, s => s === existing);
  else if (next) {
    if (statements(source).some(s => s.command === 'layout'))
      insertAfter(source, next, s => s.command === 'layout');
    else addRefinement(source, next);
  }
}

// --- Arrangements ----------------------------------------------------------------------------

/** Why the position tools stop in a sequence. */
export const LANES_HOLD =
  'A sequence keeps its lanes and rows, so layout tools have nothing to move.';

/** Set an object's soft `stay`, updating an existing one in place to keep the diff small. */
function setStay(source: SourceDoc, id: string, x: number, y: number) {
  const existing = statements(source).find(s => s.command === 'stay' && s.args[0]?.value === id);
  removeWhere(source, s => ['near', 'nudge'].includes(s.command) && s.args[0]?.value === id);
  if (existing) {
    setAttr(existing, 'x', num(x));
    setAttr(existing, 'y', num(y));
  } else {
    clearPosition(source, id);
    addRefinement(
      source,
      statement(
        'stay',
        [bare(id)],
        [
          ['x', num(x)],
          ['y', num(y)],
        ],
      ),
    );
  }
}

/**
 * Save a drawing that a layout pass, a timeline step or the brush produced. Such results depend
 * on the drawing they started from, so they cannot be recomputed from a recipe; instead each
 * object that moved gets a soft `stay` at its new position, relative to its parent.
 *
 * Groups are fitted to their contents first, as the compiler sizes them, so a group whose
 * children moved left or up moves with them instead of clipping them. Pinned objects never move.
 * Returns the ids that were given a position. A sequence draws from its lanes and rows, so it
 * takes no positions.
 */
export function writeArrangement(source: SourceDoc, drawn: Scene, after: Diagram): string[] {
  if (drawn.sequence) throw new UnsupportedEdit(LANES_HOLD);
  // Soft groups have no position; their members are placed in the container that lays them out.
  const scene = layoutView(drawn);
  const children = new Map<string, SceneObject[]>();
  for (const o of scene.objects) children.set(o.parent, [...(children.get(o.parent) ?? []), o]);
  const pinned = new Set(scene.model.hints.flatMap(h => (h.type === 'pin' ? [h.id] : [])));
  const fitted = new Map<string, Rect>(),
    header = (o: SceneObject) => groupHeaderFor(scene.look, o.titleLines);
  const fit = (o: SceneObject): Rect => {
    const known = fitted.get(o.id);
    if (known) return known;
    const r = after.layout.nodes[o.id] ?? o,
      kids = (children.get(o.id) ?? []).map(fit);
    const rect = kids.length
      ? (() => {
          const x0 = Math.min(...kids.map(k => k.x)),
            y0 = Math.min(...kids.map(k => k.y)),
            x1 = Math.max(...kids.map(k => k.x + k.w)),
            y1 = Math.max(...kids.map(k => k.y + k.h));
          return {
            x: x0 - GROUP_INSET,
            y: y0 - header(o),
            w: x1 - x0 + 2 * GROUP_INSET,
            h: y1 - y0 + header(o) + GROUP_INSET,
          };
        })()
      : { x: r.x, y: r.y, w: o.w, h: o.h };
    fitted.set(o.id, rect);
    return rect;
  };
  scene.objects.forEach(fit);

  const placed: string[] = [];
  for (const o of scene.objects) {
    if (pinned.has(o.id)) continue;
    const r = fitted.get(o.id)!,
      origin =
        o.parent === 'root'
          ? { x: 0, y: 0 }
          : contentOrigin(fitted.get(o.parent)!, header(scene.byId.get(o.parent)!));
    const x = Math.round(r.x - origin.x),
      y = Math.round(r.y - origin.y);
    if (Math.abs(x - o.localX) < 1 && Math.abs(y - o.localY) < 1) continue;
    setStay(source, o.id, x, y);
    placed.push(o.id);
  }
  return placed;
}
