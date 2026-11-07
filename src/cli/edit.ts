/**
 * `draftably set`, `rm` and `mv`: change a file's declarations by id, so an agent never edits
 * `.draft` text with string replacement. Each returns the new source, printed by the formatter;
 * comments and unrelated lines are kept.
 */
import {
  bare,
  declaration,
  edgeStatement,
  getAttr,
  quoted,
  removeEdge,
  removeReferences,
  removeWhere,
  setAttr,
  statements,
} from '../dsl/source-edits';
import { DslError, parseModel, printSource, readSource, type Statement } from '../dsl/syntax';

const ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** The declaration or edge `target` names: `node.id`, `group.id`, `edge.id`, or a bare id. */
function find(source: string, target: string) {
  const doc = readSource(source),
    kind = /^(node|group|edge)\./.exec(target)?.[1],
    id = kind ? target.slice(kind.length + 1) : target;
  const s =
    kind === 'edge'
      ? edgeStatement(doc, id)
      : (declaration(doc, id) ?? (kind ? undefined : edgeStatement(doc, id)));
  if (!s || (kind && kind !== 'edge' && s.command !== kind))
    throw new DslError(`No ${kind ?? 'node, group or edge'} ${id}.`);
  return { doc, s, id };
}

/** Where a statement keeps its label among its arguments. */
const labelAt = (s: Statement) => (s.command === 'edge' ? 4 : 1);

/**
 * Set fields on one declaration: `label="…"` replaces its label, `key=value` sets an attribute,
 * and `key=` removes it.
 */
export function setFields(source: string, target: string, fields: string[]) {
  const { doc, s } = find(source, target);
  if (!fields.length) throw new DslError('Give at least one field, such as label="New label".');
  for (const field of fields) {
    const at = field.indexOf('=');
    if (at < 1) throw new DslError(`Fields are key=value; got ${field}.`);
    const key = field.slice(0, at),
      value = field.slice(at + 1).replace(/^"(.*)"$/, '$1');
    if (key === 'label') {
      const i = labelAt(s);
      while (s.args.length < i) s.args.push(quoted(''));
      s.args[i] = quoted(value);
    } else
      setAttr(
        s,
        key,
        value === '' ? undefined : /^[\w.-]+$/.test(value) ? bare(value) : quoted(value),
      );
  }
  return check(printSource(doc));
}

/**
 * Remove nodes, groups or edges by id. A node takes its edges, refinements and `phase` and `state`
 * mentions with it; a group's members move up to the group's own container.
 */
export function removeIds(source: string, ids: string[]) {
  if (!ids.length) throw new DslError('Name the ids to remove.');
  let next = source;
  for (const target of ids) {
    const { doc, s, id } = find(next, target);
    if (s.command === 'edge') removeEdge(doc, id);
    else {
      const parent = getAttr(s, 'in');
      for (const member of statements(doc))
        if (getAttr(member, 'in')?.value === id) setAttr(member, 'in', parent);
      removeWhere(doc, x => x === s);
      removeReferences(doc, id);
    }
    next = printSource(doc);
  }
  return check(next);
}

/**
 * Rename an id everywhere it is used: declarations, edges, `in=`, refinements and states, their
 * `context=` lists included.
 */
export function renameId(source: string, from: string, to: string) {
  if (!ID.test(to)) throw new DslError(`${to} is not a valid id.`);
  const { doc } = find(source, from);
  if (declaration(doc, to) || edgeStatement(doc, to)) throw new DslError(`${to} is already used.`);
  for (const s of statements(doc)) {
    // Labels and other text are quoted; ids never are.
    s.args = s.args.map(w => (!w.quoted && w.value === from ? bare(to) : w));
    for (const key of ['in', 'root'])
      if (getAttr(s, key)?.value === from) setAttr(s, key, bare(to));
    const context = s.command === 'state' ? getAttr(s, 'context')?.value.split(',') : undefined;
    if (context?.includes(from))
      setAttr(s, 'context', bare(context.map(x => (x === from ? to : x)).join(',')));
  }
  return check(printSource(doc));
}

/** The edited source, refused if it no longer parses. */
function check(source: string) {
  parseModel(source);
  return source;
}
