/** Build native source from the facts retained by an importer. */
import type { EndMarker } from '../model/markers';

export type Format = 'dot' | 'mermaid' | 'd2';
export type Impact = 'syntax' | 'semantics' | 'appearance' | 'layout' | 'security' | 'limit';
export interface Diagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  impact: Impact;
  message: string;
  line?: number;
  column?: number;
  foreignIds?: string[];
}
export interface NativeObject {
  id: string;
  kind: 'node' | 'group';
  label: string;
  parent?: string;
  shape?: 'box' | 'pill' | 'circle' | 'diamond' | 'text';
  color?: string;
  shade?: number;
}
export interface NativeEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  directed: boolean;
  head?: EndMarker;
  tail?: EndMarker;
  dashed?: boolean;
  /** Sequence diagrams: the kind of message, and the earlier message a reply answers. */
  message?: 'call' | 'send' | 'reply';
  answers?: string;
  constraint?: false;
  fromSide?: 'left' | 'right' | 'top' | 'bottom';
  toSide?: 'left' | 'right' | 'top' | 'bottom';
}
export interface NativeLayout {
  scope: string;
  kind: 'flow' | 'column' | 'row' | 'sequence';
  /** `sequence` only: draw activation bars from calls and their replies. */
  activations?: true;
  direction?: 'right' | 'down';
}
export interface NativeColor {
  name: string;
  fill: string;
  stroke: string;
  ink: string;
}
export interface NativePhase {
  id: string;
  label: string;
  members: string[];
}
export interface NativeNote {
  text: string;
  near?: string;
  side?: 'left' | 'right' | 'above' | 'below';
}
export interface NativePlan {
  title: string;
  objects: NativeObject[];
  edges: NativeEdge[];
  layouts: NativeLayout[];
  colors: NativeColor[];
  /** Sequence diagrams only. */
  phases?: NativePhase[];
  notes?: NativeNote[];
}
export interface IdMapping {
  kind: string;
  foreign: string;
  native: string;
}
export interface ImportResult {
  status: 'ready' | 'needs-review' | 'failed';
  format: Format;
  family: string;
  diagnostics: Diagnostic[];
  /** Absent on every fatal error; callers must not apply a partial graph. */
  nativeSource?: string;
  facts?: NativePlan;
  ids: IdMapping[];
  requires: string[];
}
export const LIMITS = Object.freeze({
  sourceBytes: 256 * 1024,
  objects: 500,
  edges: 1200,
  depth: 12,
  labelChars: 16 * 1024,
  totalLabelBytes: 1024 * 1024,
  outputBytes: 1024 * 1024,
  nativeSourceChars: 300_000,
});
const reserved = new Set(['root', '__proto__', 'constructor', 'prototype']);
export class Ids {
  readonly entries: IdMapping[] = [];
  private readonly byForeign = new Map<string, string>();
  private readonly taken = new Set(reserved);
  get(kind: string, foreign: string, preferred = foreign): string {
    const key = JSON.stringify([kind, foreign]);
    const old = this.byForeign.get(key);
    if (old) return old;
    let base = [...preferred]
      .map(c => (/[A-Za-z0-9_.-]/.test(c) ? c : '_u' + c.codePointAt(0)!.toString(16) + '_'))
      .join('');
    if (!/^[A-Za-z_]/.test(base)) base = kind + '_' + base;
    if (!base || reserved.has(base)) base = kind + '_' + (base || 'item');
    let id = base;
    for (let n = 2; this.taken.has(id); n++) id = base + '__' + n;
    this.byForeign.set(key, id);
    this.taken.add(id);
    this.entries.push({ kind, foreign, native: id });
    return id;
  }
}
export const quote = (value: string) => JSON.stringify(value);
export const blankPlan = (title: string): NativePlan => ({
  title,
  objects: [],
  edges: [],
  layouts: [],
  colors: [],
});
export function inputLimit(source: string): Diagnostic[] {
  if (new TextEncoder().encode(source).length <= LIMITS.sourceBytes && !source.includes('\0'))
    return [];
  return [
    {
      code: 'IMPORT_INPUT_LIMIT',
      severity: 'error',
      impact: 'limit',
      message: 'Input must be UTF-8 text without NUL and at most 256 KiB.',
    },
  ];
}
export function finish(
  format: Format,
  family: string,
  plan: NativePlan,
  diagnostics: Diagnostic[],
  ids: Ids,
): ImportResult {
  const error = (code: string, message: string, impact: Impact = 'semantics') =>
    diagnostics.push({ code, severity: 'error', impact, message });
  if (plan.objects.length > LIMITS.objects || plan.edges.length > LIMITS.edges)
    error(
      'IMPORT_GRAPH_LIMIT',
      'Native source allows at most 500 nodes plus groups, and 1,200 edges.',
      'limit',
    );
  const encoder = new TextEncoder();
  const labels = [plan.title, ...plan.objects.map(o => o.label), ...plan.edges.map(e => e.label)];
  if (labels.reduce((sum, label) => sum + encoder.encode(label).length, 0) > LIMITS.totalLabelBytes)
    error(
      'IMPORT_TOTAL_LABEL_LIMIT',
      'Expanded native labels exceed a combined 1 MiB of UTF-8 text.',
      'limit',
    );
  if (plan.title.length > LIMITS.labelChars)
    error('IMPORT_LABEL_LIMIT', 'Diagram title exceeds 16,384 characters.', 'limit');
  const byId = new Map(plan.objects.map(o => [o.id, o]));
  const allIds = [...plan.objects.map(o => o.id), ...plan.edges.map(e => e.id)];
  if (
    new Set(allIds).size !== allIds.length ||
    allIds.some(id => reserved.has(id) || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id))
  )
    error('IMPORT_ID_INVARIANT', 'Generated IDs must be safe, globally unique native identifiers.');
  const ancestors = (id: string) => {
    const result: string[] = [];
    let at = byId.get(id)?.parent;
    while (at) {
      if (result.includes(at) || result.length >= LIMITS.depth) {
        error('IMPORT_HIERARCHY', 'Containment cycle or excessive nesting.');
        break;
      }
      result.push(at);
      if (byId.get(at)?.kind !== 'group') {
        error('IMPORT_PARENT', 'Missing or non-group parent: ' + at);
        break;
      }
      at = byId.get(at)?.parent;
    }
    return result;
  };
  for (const o of plan.objects) {
    if (ancestors(o.id).length + 1 > LIMITS.depth)
      error('IMPORT_DEPTH', 'Native source permits 12 nesting levels.', 'limit');
    if (o.label.length > LIMITS.labelChars)
      error('IMPORT_LABEL_LIMIT', 'Label exceeds 16,384 characters.', 'limit');
  }
  for (const e of plan.edges) {
    if (!byId.has(e.from) || !byId.has(e.to))
      error('IMPORT_ENDPOINT', 'Missing endpoint for ' + e.id);
    if (ancestors(e.from).includes(e.to) || ancestors(e.to).includes(e.from))
      error(
        'IMPORT_ANCESTOR_EDGE',
        'Native source cannot connect a group to one of its descendants.',
      );
    if (e.label.length > LIMITS.labelChars)
      error('IMPORT_LABEL_LIMIT', 'Edge label exceeds 16,384 characters.', 'limit');
  }
  const requires = plan.edges.some(e => !e.directed) ? ['IMP-02-native-undirected'] : [];
  if (diagnostics.some(d => d.severity === 'error'))
    return { status: 'failed', format, family, diagnostics, ids: ids.entries, requires };
  const lines = ['diagram ' + quote(plan.title) + ' version=1'];
  for (const c of plan.colors)
    lines.push(
      'theme-color ' +
        c.name +
        ' shade=500 fill=' +
        quote(c.fill) +
        ' stroke=' +
        quote(c.stroke) +
        ' ink=' +
        quote(c.ink),
    );
  for (const o of plan.objects) {
    let s = o.kind + ' ' + o.id + ' ' + quote(o.label);
    if (o.parent) s += ' in=' + o.parent;
    if (o.shape && o.shape !== 'box' && o.kind === 'node') s += ' shape=' + o.shape;
    if (o.color) s += ' color=' + o.color + ' shade=' + (o.shade ?? 500);
    lines.push(s);
  }
  for (const e of plan.edges) {
    let s = 'edge ' + e.id + ' ' + e.from + ' -> ' + e.to + ' ' + quote(e.label);
    if (!e.directed) s += ' directed=false';
    if (e.head && e.head !== 'arrow') s += ' head=' + e.head;
    if (e.tail && e.tail !== 'none') s += ' tail=' + e.tail;
    // A reply that names its message needs only `answers=`.
    if (e.answers) s += ' answers=' + e.answers;
    else if (e.message) s += ' message=' + e.message;
    else if (e.dashed) s += ' kind=async';
    if (e.constraint === false) s += ' constraint=false';
    if (e.fromSide) s += ' from=' + e.fromSide;
    if (e.toSide) s += ' to=' + e.toSide;
    lines.push(s);
  }
  for (const l of plan.layouts)
    lines.push(
      'layout ' +
        l.scope +
        ' ' +
        l.kind +
        (l.direction ? ' direction=' + l.direction : '') +
        (l.activations ? ' activations=on' : ''),
    );
  for (const p of plan.phases ?? [])
    lines.push(['phase', p.id, quote(p.label), ...p.members].join(' '));
  for (const n of plan.notes ?? []) {
    let s = 'note ' + quote(n.text);
    if (n.near) s += ' near=' + n.near;
    if (n.side) s += ' side=' + n.side;
    lines.push(s);
  }
  const nativeSource = lines.join('\n') + '\n';
  if (nativeSource.length > LIMITS.nativeSourceChars)
    error(
      'IMPORT_NATIVE_SOURCE_LIMIT',
      'Generated source exceeds the native parser limit of 300,000 source characters.',
      'limit',
    );
  if (encoder.encode(nativeSource).length > LIMITS.outputBytes) {
    error('IMPORT_OUTPUT_LIMIT', 'Generated native source exceeds 1 MiB of UTF-8 text.', 'limit');
  }
  if (diagnostics.some(d => d.severity === 'error'))
    return { status: 'failed', format, family, diagnostics, ids: ids.entries, requires };
  return {
    status: diagnostics.some(d => d.severity === 'warning') ? 'needs-review' : 'ready',
    format,
    family,
    diagnostics,
    ids: ids.entries,
    requires,
    nativeSource,
    facts: plan,
  };
}
/** Only an explicit hex color is accepted. No CSS, URL, or Graphviz colorscheme interpretation. */
export function hex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^#[a-f0-9]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[a-f0-9]{3}$/i.test(value))
    return (
      '#' +
      [...value.slice(1)]
        .map(c => c + c)
        .join('')
        .toLowerCase()
    );
  return undefined;
}
export function applyColor(
  plan: NativePlan,
  o: NativeObject,
  fill?: string,
  stroke?: string,
  ink?: string,
) {
  if (!fill && !stroke && !ink) return;
  const c = { fill: fill ?? '#ffffff', stroke: stroke ?? '#64748b', ink: ink ?? '#172033' };
  let old = plan.colors.find(x => x.fill === c.fill && x.stroke === c.stroke && x.ink === c.ink);
  if (!old) {
    old = { name: 'import_' + (plan.colors.length + 1), ...c };
    plan.colors.push(old);
  }
  o.color = old.name;
  o.shade = 500;
}
