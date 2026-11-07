/**
 * What an edit did to a source, statement by statement: which statements it added, removed or
 * changed, each named by what it is about. A host that keeps diagrams as its own records (rows in
 * a database, a draft) maps these to its records instead of comparing text.
 */
import { statements } from './source-edits';
import { printStatement, type SourceDoc, type Statement } from './syntax';

/** One statement an edit added, removed or changed. */
export interface SourceOperation {
  /** `add`: a new statement. `remove`: a statement gone. `set`: a statement whose words changed. */
  kind: 'set' | 'add' | 'remove';
  /** The statement's command: `node`, `edge`, `stay`, `near`, `size`, `order`, … */
  statement: string;
  /**
   * What the statement is about: a node's, group's or edge's id; the object a placement (`near`,
   * `stay`, `pin`, `nudge`, `size`) places; a `layout` or `order` line's scope; an `align` line's
   * ids, comma-separated. Empty for a statement about the whole diagram, such as `theme`.
   */
  id: string;
  /**
   * The statement's words by name (as removed, for `remove`): its attributes (`x`, `y`, `in`,
   * `side`, …) and its positional words (`label` for a node, group or edge; `from` and `to` for an
   * edge; `ref` for a `near`; `algorithm` for a `layout`; `members`, comma-separated, for an
   * `order` or `align`; `axis` for an `align`). Other positional words are `arg1`, `arg2`, ….
   */
  fields: Record<string, string>;
  /** For a `set`: the fields before the edit. */
  was?: Record<string, string>;
}

const SUBJECT_FIRST = new Set([
  'node',
  'group',
  'edge',
  'near',
  'nudge',
  'stay',
  'pin',
  'size',
  'layout',
  'order',
  'state',
  'phase',
  'was-order',
]);

/** What a statement is about (see `SourceOperation.id`). */
function subject(s: Statement): string {
  if (s.command === 'align')
    return s.args
      .slice(1)
      .map(w => w.value)
      .join(',');
  if (s.command === 'theme-color')
    return `${s.args[0]?.value ?? ''}:${s.attrs.find(([k]) => k === 'shade')?.[1].value ?? 500}`;
  if (s.command === 'note' && s.args.length > 1) return s.args[0].value;
  return SUBJECT_FIRST.has(s.command) ? (s.args[0]?.value ?? '') : '';
}

/** A statement's words by name (see `SourceOperation.fields`). */
function fieldsOf(s: Statement): Record<string, string> {
  const out: Record<string, string> = {};
  const words = s.args.map(w => w.value);
  let rest: string[];
  switch (s.command) {
    case 'node':
    case 'group':
      if (words[1] !== undefined) out.label = words[1];
      rest = words.slice(2);
      break;
    case 'edge':
      out.from = words[1] ?? '';
      out.to = words[3] ?? '';
      if (words[4] !== undefined) out.label = words[4];
      rest = words.slice(5);
      break;
    case 'near':
      out.ref = words[1] ?? '';
      rest = words.slice(2);
      break;
    case 'layout':
      if (words[1] !== undefined) out.algorithm = words[1];
      rest = words.slice(2);
      break;
    case 'order':
    case 'was-order':
      out.members = words.slice(1).join(',');
      rest = [];
      break;
    case 'align':
      out.axis = words[0] ?? '';
      out.members = words.slice(1).join(',');
      rest = [];
      break;
    default:
      rest =
        SUBJECT_FIRST.has(s.command) || (s.command === 'note' && words.length > 1)
          ? words.slice(1)
          : words;
  }
  rest.forEach((w, i) => (out[`arg${i + 1}`] = w));
  for (const [key, value] of s.attrs) out[key] = value.value;
  if (s.mark) out.mark = s.mark;
  return out;
}

/** Statements keyed by command and subject; a repeated key takes its occurrence number. */
function keyed(doc: SourceDoc) {
  const out = new Map<string, Statement>(),
    seen = new Map<string, number>();
  for (const s of statements(doc)) {
    // An align line is also told apart by its axis: `align x a b` and `align y a b` are two.
    const axis = s.command === 'align' ? `\u0000${s.args[0]?.value}` : '',
      base = `${s.command}\u0000${subject(s)}${axis}`,
      n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(n ? `${base}\u0000${n}` : base, s);
  }
  return out;
}

/**
 * The statements `after` adds, removes and changes relative to `before`: removals in the order
 * they stood, then additions and changes in the order they now stand. A statement is matched by
 * its command and subject, so a `near` replaced by a `stay` is a removal and an addition, and a
 * renamed node is a `set` of its `label`. Comments and blank lines are not statements.
 */
export function sourceOperations(before: SourceDoc, after: SourceDoc): SourceOperation[] {
  const a = keyed(before),
    b = keyed(after),
    out: SourceOperation[] = [];
  for (const [key, s] of a)
    if (!b.has(key))
      out.push({ kind: 'remove', statement: s.command, id: subject(s), fields: fieldsOf(s) });
  for (const [key, s] of b) {
    const old = a.get(key);
    if (!old) out.push({ kind: 'add', statement: s.command, id: subject(s), fields: fieldsOf(s) });
    else if (
      printStatement({ ...old, comment: undefined }) !==
      printStatement({ ...s, comment: undefined })
    )
      out.push({
        kind: 'set',
        statement: s.command,
        id: subject(s),
        fields: fieldsOf(s),
        was: fieldsOf(old),
      });
  }
  return out;
}
