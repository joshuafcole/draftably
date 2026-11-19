/**
 * Syntax colors for code nodes: a small regex lexer per language, run synchronously so the
 * compiler, the viewer, SVG, PNG and PDF color every token the same way. A lexer only names token
 * classes over character ranges; it never changes a row's text or columns, so layout stays as
 * `model/code.ts` decides it.
 *
 * SQL, JSON, YAML and diff are exact. Python, TS/JS and shell are close: where a lexer is unsure
 * (a regex literal, nested quoting in shell, `${…}` inside a template literal), the text stays
 * uncolored rather than miscolored.
 */
import {
  ensureContrast,
  swatchFor,
  type ResolvedAppearance,
  type Shade,
  type ThemeId,
} from './appearance';
import type { CodeBlock, CodeRow, CodeRun } from './code';

export const TOKEN_CLASSES = [
  'keyword',
  'string',
  'number',
  'comment',
  'function',
  'operator',
  'punctuation',
] as const;
export type TokenClass = (typeof TOKEN_CLASSES)[number];
/** Classes of a whole diff line, drawn as a band behind the line (`hunk` colors its text). */
export type LineClass = 'added' | 'removed' | 'hunk';

/** A colored range `[from, to)` of one line (UTF-16 offsets, which are columns in code lines). */
export interface Token {
  from: number;
  to: number;
  cls: TokenClass;
}

export interface LineTokens {
  tokens: Token[];
  line?: LineClass;
}

type Cls = TokenClass | null;
/** What a rule saw last: the previous token that was not whitespace. */
interface State {
  prev?: { text: string; cls: Cls };
  /** Whitespace since `prev` held a line break. */
  newline: boolean;
}
/** A rule: the pieces it matched at `pos` (consecutive, in order), or nothing. */
type Rule = (text: string, pos: number, st: State) => Array<{ end: number; cls: Cls }> | undefined;

/** A rule from a regex; `cls` may decide from the match and the state. */
function re(regex: RegExp, cls: Cls | ((m: string, st: State, text: string, end: number) => Cls)) {
  const sticky = new RegExp(regex.source, regex.flags.replace('g', '') + 'y');
  return ((text, pos, st) => {
    sticky.lastIndex = pos;
    const m = sticky.exec(text);
    if (!m || !m[0]) return undefined;
    const end = pos + m[0].length;
    return [{ end, cls: typeof cls === 'function' ? cls(m[0], st, text, end) : cls }];
  }) satisfies Rule;
}

interface Span {
  from: number;
  to: number;
  cls: Cls;
}

const word = /[\w$]+/y;

/** Run `rules` over `text`; the first rule that matches wins, and an unmatched word is plain. */
function lex(text: string, rules: Rule[]): Span[] {
  const out: Span[] = [],
    st: State = { newline: true };
  let pos = 0;
  while (pos < text.length) {
    const ws = /\s+/y;
    ws.lastIndex = pos;
    const space = ws.exec(text);
    if (space) {
      if (space[0].includes('\n')) st.newline = true;
      pos += space[0].length;
      continue;
    }
    let pieces: Array<{ end: number; cls: Cls }> | undefined;
    for (const rule of rules) if ((pieces = rule(text, pos, st))) break;
    // Nothing matched: a word is plain as a whole, so no rule retries inside it.
    if (!pieces) {
      word.lastIndex = pos;
      pieces = [{ end: pos + (word.exec(text)?.[0].length ?? 1), cls: null }];
    }
    for (const p of pieces) {
      out.push({ from: pos, to: p.end, cls: p.cls });
      st.prev = { text: text.slice(pos, p.end), cls: p.cls };
      pos = p.end;
    }
    st.newline = false;
  }
  return out;
}

/** Split spans over the joined text back into per-line tokens, dropping plain ones. */
function perLine(lines: string[], spans: Span[]): LineTokens[] {
  const out: LineTokens[] = lines.map(() => ({ tokens: [] }));
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  let li = 0;
  for (const s of spans) {
    if (!s.cls) continue;
    while (li + 1 < lines.length && starts[li + 1] <= s.from) li++;
    for (let i = li; i < lines.length && starts[i] < s.to; i++) {
      const from = Math.max(s.from, starts[i]) - starts[i],
        to = Math.min(s.to, starts[i] + lines[i].length) - starts[i];
      if (to > from) out[i].tokens.push({ from, to, cls: s.cls });
    }
  }
  return out;
}

const words = (s: string) => new Set(s.split(/\s+/));
const IDENT = /[A-Za-z_][\w$]*/;
/** The next character after `end` that is not a space or tab. */
const nextChar = (text: string, end: number) => /^[ \t]*(.?)/.exec(text.slice(end, end + 200))![1];

// --- SQL ---------------------------------------------------------------------------------------

const SQL_KEYWORDS = words(`
  ADD ALL ALTER AND ANY AS ASC BEGIN BETWEEN BY CASE CAST CHECK COLLATE COLUMN COMMIT CONSTRAINT
  CREATE CROSS CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE DEFAULT DELETE DESC DISTINCT
  DROP ELSE END ESCAPE EXCEPT EXISTS EXPLAIN FALSE FETCH FILTER FIRST FOLLOWING FOR FOREIGN FROM
  FULL GROUP HAVING IF ILIKE IN INDEX INNER INSERT INTERSECT INTERVAL INTO IS JOIN KEY LAST LATERAL
  LEFT LIKE LIMIT MATERIALIZED NATURAL NOT NULL NULLS OFFSET ON OR ORDER OUTER OVER PARTITION
  PRECEDING PRIMARY RANGE RECURSIVE REFERENCES REPLACE RETURNING RIGHT ROLLBACK ROW ROWS SELECT SET
  SOME TABLE THEN TO TOP TRANSACTION TRUE TRUNCATE UNBOUNDED UNION UNIQUE UPDATE USING VALUES VIEW
  WHEN WHERE WINDOW WITH WITHIN`);

const SQL: Rule[] = [
  re(/--[^\n]*/, 'comment'),
  re(/\/\*[\s\S]*?(?:\*\/|$)/, 'comment'),
  re(/[eE]?'(?:[^']|'')*'?/, 'string'),
  re(/"(?:[^"]|"")*"?|`[^`]*`?/, null),
  re(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?![\w$])/, 'number'),
  re(/[:@$]\w+/, null),
  re(IDENT, (m, st, text, end) =>
    st.prev?.text === '.'
      ? null
      : SQL_KEYWORDS.has(m.toUpperCase())
        ? 'keyword'
        : nextChar(text, end) === '('
          ? 'function'
          : null,
  ),
  re(/<>|!=|<=|>=|\|\||::|[=<>+\-*/%]/, 'operator'),
  re(/[(),;.[\]]/, 'punctuation'),
];

// --- Python ------------------------------------------------------------------------------------

const PY_KEYWORDS = words(`
  False None True and as assert async await break class continue def del elif else except finally
  for from global if import in is lambda nonlocal not or pass raise return try while with yield
  match case`);

const PYTHON: Rule[] = [
  re(/#[^\n]*/, 'comment'),
  re(/(?:[rRbBuUfF]{1,2})?(?:'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$))/, 'string'),
  re(/(?:[rRbBuUfF]{1,2})?(?:'(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?)/, 'string'),
  re(/@[A-Za-z_][\w.]*/, (_m, st) => (st.newline || !st.prev ? 'function' : null)),
  re(
    /(?:0[xXbBoO][\da-fA-F_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?)(?![\w$])/,
    'number',
  ),
  re(IDENT, (m, st, text, end) =>
    st.prev?.text === '.' && nextChar(text, end) !== '('
      ? null
      : PY_KEYWORDS.has(m)
        ? 'keyword'
        : st.prev?.text === 'def' || st.prev?.text === 'class' || nextChar(text, end) === '('
          ? 'function'
          : null,
  ),
  re(/\*\*=?|\/\/=?|->|:=|[=!<>]=|<<=?|>>=?|[-+*/%&|^~<>=@]=?/, 'operator'),
  re(/[()[\]{},:;.]/, 'punctuation'),
];

// --- TypeScript and JavaScript -----------------------------------------------------------------

const TS_KEYWORDS = words(`
  abstract as async await break case catch class const continue declare default delete do else
  enum export extends false finally for from function get if implements import in infer instanceof
  interface keyof let namespace new null of private protected public readonly return satisfies set
  static super switch this throw true try type typeof undefined var void while with yield`);

/** Where a `/` starts a regex literal rather than dividing. */
const OPERAND_BEFORE =
  /^(?:[(,=:[!&|?{};+\-*%<>~^]|=>|&&|\|\||\?\?|return|typeof|case|do|else|in|of|yield|await)$/;

/**
 * A template literal: its text is a string; `${…}` inside stays plain. A backtick inside `${…}`
 * is nesting this lexer does not follow, so the rest of the template stays plain.
 */
const template: Rule = (text, pos) => {
  if (text[pos] !== '`') return undefined;
  const out: Array<{ end: number; cls: Cls }> = [];
  let i = pos + 1,
    start = pos;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') i += 2;
    else if (c === '`') {
      out.push({ end: i + 1, cls: 'string' });
      return out;
    } else if (c === '$' && text[i + 1] === '{') {
      if (i > start) out.push({ end: i, cls: 'string' });
      let depth = 1,
        j = i + 2;
      while (j < text.length && depth) {
        if (text[j] === '`') return [...out, { end: text.length, cls: null }];
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      out.push({ end: j, cls: null });
      i = start = j;
    } else i++;
  }
  out.push({ end: text.length, cls: 'string' });
  return out.filter((p, k) => k === 0 || p.end > out[k - 1].end);
};

const TS: Rule[] = [
  re(/\/\/[^\n]*/, 'comment'),
  re(/\/\*[\s\S]*?(?:\*\/|$)/, 'comment'),
  re(/'(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?/, 'string'),
  template,
  // A regex literal: approximated, so it stays plain.
  (text, pos, st) => {
    if (text[pos] !== '/' || (st.prev && !OPERAND_BEFORE.test(st.prev.text))) return undefined;
    const m = /\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[a-z]*/y;
    m.lastIndex = pos;
    const hit = m.exec(text);
    return hit ? [{ end: pos + hit[0].length, cls: null }] : undefined;
  },
  re(
    /(?:0[xXbBoO][\da-fA-F_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)(?![\w$])/,
    'number',
  ),
  re(/[A-Za-z_$][\w$]*/, (m, st, text, end) =>
    st.prev?.text === '.' && nextChar(text, end) !== '('
      ? null
      : TS_KEYWORDS.has(m) && st.prev?.text !== '.'
        ? 'keyword'
        : st.prev?.text === 'function' || nextChar(text, end) === '('
          ? 'function'
          : null,
  ),
  re(
    /=>|\.\.\.|\?\?=?|\?\.|[=!]==?|<=|>=|&&=?|\|\|=?|\*\*=?|<<=?|>>>?=?|[-+*/%&|^~!<>=?:]=?/,
    'operator',
  ),
  re(/[()[\]{},;.@#]/, 'punctuation'),
];

// --- JSON --------------------------------------------------------------------------------------

const JSON_RULES: Rule[] = [
  re(/"(?:[^"\\\n]|\\.)*"?/, (_m, _st, text, end) =>
    nextChar(text, end) === ':' ? 'keyword' : 'string',
  ),
  re(/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])/, 'number'),
  re(/(?:true|false|null)(?!\w)/, 'keyword'),
  re(/[{}[\],:]/, 'punctuation'),
];

// --- YAML (line by line) -----------------------------------------------------------------------

const YAML_CONSTANTS = /^(?:true|false|null|yes|no|on|off|True|False|TRUE|FALSE|Null|NULL|~)$/;
const YAML_NUMBER =
  /^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$|^0x[\da-fA-F]+$|^0o[0-7]+$/;

/** A plain or quoted scalar from `from` to the end of the value; a trailing comment is split off. */
function yamlValue(line: string, from: number, out: Token[], flow: boolean) {
  let i = from;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      out.push({ from: i, to: line.length, cls: 'comment' });
      return;
    }
    if (c === '"' || c === "'") {
      const m = c === '"' ? /"(?:[^"\\]|\\.)*"?/y : /'(?:[^']|'')*'?/y;
      m.lastIndex = i;
      const end = i + m.exec(line)![0].length;
      out.push({ from: i, to: end, cls: 'string' });
      i = end;
      continue;
    }
    if ('{}[],'.includes(c) || (c === ':' && /\s|$/.test(line[i + 1] ?? ''))) {
      out.push({ from: i, to: i + 1, cls: 'punctuation' });
      i++;
      if (flow && (c === '{' || c === ',')) i = yamlKey(line, i, out);
      continue;
    }
    if (c === '&' || c === '*' || c === '!') {
      const end = i + /^\S+/.exec(line.slice(i))![0].length;
      out.push({ from: i, to: end, cls: 'function' });
      i = end;
      continue;
    }
    if ((c === '|' || c === '>') && /^[|>][-+0-9]*\s*(?:#.*)?$/.test(line.slice(i))) {
      const end = i + /^[|>][-+0-9]*/.exec(line.slice(i))![0].length;
      out.push({ from: i, to: end, cls: 'operator' });
      i = end;
      continue;
    }
    // A plain scalar runs to a comment, or in a flow collection to the next , ] or }.
    const stop = flow ? /\s#|[,\]}]|:\s/ : /\s#/;
    const rest = line.slice(i),
      cut = rest.search(stop),
      raw = cut < 0 ? rest : rest.slice(0, cut),
      word = raw.trimEnd();
    const cls = YAML_CONSTANTS.test(word) ? 'keyword' : YAML_NUMBER.test(word) ? 'number' : null;
    if (cls) out.push({ from: i, to: i + word.length, cls });
    i += Math.max(1, raw.length);
  }
}

/** A mapping key at `from` (after indent, `- ` or a flow `{`/`,`); returns where its value starts. */
function yamlKey(line: string, from: number, out: Token[]): number {
  let i = from;
  while (line[i] === ' ') i++;
  const m =
    /(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"{}[\],&*!|>][^#{}[\],]*?)(?=[ \t]*:(?:\s|$))/y;
  m.lastIndex = i;
  const hit = m.exec(line);
  if (!hit) return i;
  out.push({ from: i, to: i + hit[0].length, cls: 'keyword' });
  return i + hit[0].length;
}

function yamlLines(lines: string[]): LineTokens[] {
  let block = -1; // indent of the key that opened a block scalar, or -1
  return lines.map(line => {
    const tokens: Token[] = [],
      indent = line.length - line.trimStart().length;
    if (block >= 0) {
      if (!line.trim() || indent > block) {
        if (line.trim()) tokens.push({ from: indent, to: line.length, cls: 'string' });
        return { tokens };
      }
      block = -1;
    }
    if (/^#/.test(line.trimStart()))
      return { tokens: [{ from: indent, to: line.length, cls: 'comment' }] };
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(line)) {
      tokens.push({ from: 0, to: 3, cls: 'punctuation' });
      yamlValue(line, 3, tokens, false);
      return { tokens };
    }
    let i = indent;
    while (/^-(?:\s|$)/.test(line.slice(i))) {
      tokens.push({ from: i, to: i + 1, cls: 'punctuation' });
      i += 1;
      while (line[i] === ' ') i++;
    }
    const after = yamlKey(line, i, tokens);
    const flow = /^[\s:]*[[{]/.test(line.slice(after));
    yamlValue(line, after, tokens, flow);
    // Only `yamlValue`'s block indicator opens a block scalar, never text in a comment.
    if (tokens.some(t => t.cls === 'operator')) block = indent;
    return { tokens };
  });
}

// --- Shell -------------------------------------------------------------------------------------

const SH_KEYWORDS = words(`
  if then else elif fi for in do done while until case esac function select time return export
  local readonly declare break continue exit`);
/** Tokens after which the next word is a command. */
const COMMAND_AFTER =
  /^(?:\||\|\||&&|;|;;|&|\(|\$\(|`|\{|!|then|do|else|elif|if|while|until|time|sudo|exec|xargs|env)$/;

const isCommandPos = (st: State) =>
  !st.prev ||
  (st.newline && st.prev.text !== '\\' && st.prev.cls !== 'operator') ||
  COMMAND_AFTER.test(st.prev.text);

/** A double-quoted string; one that holds `$(…)` or a backtick is nesting, so it stays plain. */
const shDouble: Rule = (text, pos) => {
  if (text[pos] !== '"') return undefined;
  let i = pos + 1,
    depth = 0,
    nested = false;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') i += 2;
    else if (c === '`') {
      nested = true;
      i++;
    } else if (c === '$' && text[i + 1] === '(') {
      nested = true;
      depth++;
      i += 2;
    } else if (depth && c === ')') {
      depth--;
      i++;
    } else if (depth && c === '"') {
      const close = text.indexOf('"', i + 1);
      i = close < 0 ? text.length : close + 1;
    } else if (!depth && c === '"') return [{ end: i + 1, cls: nested ? null : 'string' }];
    else i++;
  }
  return [{ end: text.length, cls: null }];
};

const SH: Rule[] = [
  re(/#[^\n]*/, 'comment'),
  re(/\$'(?:[^'\\]|\\.)*'?|'[^']*'?/, 'string'),
  shDouble,
  re(/\$\(\(?|\$\{|\$\[|\[\[|\]\]|[()[\]{}]/, 'punctuation'),
  re(/\$(?:[A-Za-z_]\w*|[0-9@#?$!*-])/, null),
  re(/\\$/m, 'punctuation'),
  re(/\\./, null),
  re(/&>>?|[0-9]?(?:>>?|<<<?|<)&?[0-9-]?|\|\||&&|;;|\||[;&!]/, 'operator'),
  re(/[A-Za-z_]\w*(?==)/, null),
  re(/=/, 'operator'),
  re(/[0-9]+(?![^\s;|&)<>])/, 'number'),
  re(/[^\s'"`$;|&()<>{}\\=]+/, (m, st) =>
    SH_KEYWORDS.has(m) && isCommandPos(st)
      ? 'keyword'
      : isCommandPos(st) && /^[\w./~+-]+$/.test(m) && !m.startsWith('-')
        ? 'function'
        : null,
  ),
];

/** A `#` starts a comment only at the start of a word. */
function shellRules(): Rule[] {
  const [comment, ...rest] = SH;
  return [
    (text, pos, st) =>
      text[pos] === '#' && (pos === 0 || /\s/.test(text[pos - 1]))
        ? comment(text, pos, st)
        : undefined,
    ...rest,
  ];
}

/**
 * The heredocs a shell line opens, as `[dash, tag]`: `<<` as an operator, not inside quotes, a
 * comment or arithmetic `$((…))`, and not part of `<<<`.
 */
function heredocTags(line: string): Array<[boolean, string]> {
  const out: Array<[boolean, string]> = [],
    op = /<<(-?)[ \t]*(['"]?)([A-Za-z_]\w*)\2/y;
  let quote = '',
    arith = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') i++;
    else if (quote) {
      if (c === quote) quote = '';
    } else if (arith) {
      if (c === '(') arith++;
      else if (c === ')') arith--;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    else if (line.startsWith('((', i)) {
      arith = 2;
      i++;
    } else if (line.startsWith('<<', i) && line[i + 2] !== '<' && line[i - 1] !== '<') {
      op.lastIndex = i;
      const m = op.exec(line);
      if (m) {
        out.push([!!m[1], m[3]]);
        i += m[0].length - 1;
      }
    }
  }
  return out;
}

/**
 * Shell lines. A heredoc body (`<<EOF` up to a line holding `EOF`) is a string, and its lines are
 * blanked before lexing so quotes inside it never pair with code outside.
 */
function shellLines(lines: string[]): LineTokens[] {
  const body = new Map<number, 'body' | 'end'>();
  for (let i = 0; i < lines.length; i++) {
    if (body.has(i)) continue;
    let j = i + 1;
    for (const [dash, tag] of heredocTags(lines[i])) {
      // A heredoc with no closing line is likely a misread: leave the lines after it as code.
      let end = j;
      while (
        end < lines.length &&
        (dash ? lines[end].replace(/^\t+/, '') : lines[end]).trim() !== tag
      )
        end++;
      if (end === lines.length) continue;
      for (; j < end; j++) body.set(j, 'body');
      body.set(j++, 'end');
    }
  }
  const code = lines.map((l, i) => (body.has(i) ? ' '.repeat(l.length) : l));
  const out = perLine(lines, lex(code.join('\n'), shellRules()));
  for (const [i, kind] of body) {
    const l = lines[i],
      from = l.length - l.trimStart().length;
    if (l.trim())
      out[i] = { tokens: [{ from, to: l.length, cls: kind === 'end' ? 'punctuation' : 'string' }] };
  }
  return out;
}

// --- Diff --------------------------------------------------------------------------------------

function diffLines(lines: string[]): LineTokens[] {
  return lines.map((l, i) => {
    const whole = (cls: TokenClass): LineTokens => ({
      tokens: l ? [{ from: 0, to: l.length, cls }] : [],
    });
    if (l.startsWith('@@')) return { ...whole('keyword'), line: 'hunk' };
    if (
      (l.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) ||
      (l.startsWith('+++ ') && lines[i - 1]?.startsWith('--- ')) ||
      /^(?:diff |index |new file mode|deleted file mode|similarity index|rename (?:from|to) )/.test(
        l,
      )
    )
      return whole('comment');
    if (l.startsWith('+')) return { tokens: [], line: 'added' };
    if (l.startsWith('-')) return { tokens: [], line: 'removed' };
    if (l.startsWith('\\')) return whole('comment');
    return { tokens: [] };
  });
}

// --- Entry -------------------------------------------------------------------------------------

const LEXERS: Record<string, (lines: string[]) => LineTokens[]> = {
  sql: l => perLine(l, lex(l.join('\n'), SQL)),
  python: l => perLine(l, lex(l.join('\n'), PYTHON)),
  ts: l => perLine(l, lex(l.join('\n'), TS)),
  js: l => perLine(l, lex(l.join('\n'), TS)),
  json: l => perLine(l, lex(l.join('\n'), JSON_RULES)),
  yaml: yamlLines,
  sh: shellLines,
  diff: diffLines,
};

/** Languages with a lexer. */
export const HIGHLIGHT_LANGS = Object.keys(LEXERS);

/** Tokens of each line of a listing in a language, or undefined when it has no lexer. */
export function tokenize(lang: string | undefined, lines: string[]): LineTokens[] | undefined {
  const lexer = lang ? LEXERS[lang] : undefined;
  if (!lexer) return undefined;
  return lexer(lines).map(l => ({ ...l, tokens: l.tokens.sort((a, b) => a.from - b.from) }));
}

const cache = new WeakMap<CodeBlock, LineTokens[] | undefined>();

/** `tokenize` for a code node's body, computed once per body. */
export function codeTokens(code: CodeBlock): LineTokens[] | undefined {
  if (!cache.has(code)) cache.set(code, tokenize(code.lang, code.lines));
  return cache.get(code);
}

// --- Colors ------------------------------------------------------------------------------------

/** Contrast every token color keeps against the fill it sits on. */
export const TOKEN_CONTRAST = 4.5;

type Pick = [family: string, shade: Shade];
/**
 * Each theme's token colors, taken from its own families. Light themes use deep shades; dark ones
 * (Blueprint, and Drafting on a dark page) use pale shades. Comments sit nearest the plain ink.
 */
const TOKEN_FAMILIES: Record<ThemeId, Record<TokenClass, Pick>> = {
  drafting: {
    keyword: ['primary', 700],
    string: ['green', 700],
    number: ['orange', 700],
    comment: ['slate', 500],
    function: ['violet', 600],
    operator: ['teal', 700],
    punctuation: ['slate', 600],
  },
  fieldnotes: {
    keyword: ['primary', 700],
    string: ['green', 700],
    number: ['secondary', 700],
    comment: ['stone', 500],
    function: ['violet', 600],
    operator: ['teal', 700],
    punctuation: ['stone', 600],
  },
  signal: {
    keyword: ['blue', 700],
    string: ['green', 700],
    number: ['orange', 700],
    comment: ['slate', 500],
    function: ['rose', 700],
    operator: ['sky', 800],
    punctuation: ['slate', 600],
  },
  ink: {
    keyword: ['primary', 800],
    string: ['secondary', 700],
    number: ['amber', 800],
    comment: ['stone', 500],
    function: ['blue', 700],
    operator: ['stone', 700],
    punctuation: ['stone', 600],
  },
  blueprint: {
    keyword: ['primary', 300],
    string: ['secondary', 300],
    number: ['orange', 300],
    comment: ['slate', 400],
    function: ['rose', 300],
    operator: ['sky', 200],
    punctuation: ['slate', 300],
  },
  'drafting-dark': {
    keyword: ['primary', 300],
    string: ['green', 300],
    number: ['orange', 300],
    comment: ['slate', 400],
    function: ['violet', 300],
    operator: ['teal', 300],
    punctuation: ['slate', 300],
  },
};

export interface CodeColors {
  tokens: Record<TokenClass, string>;
  /** Band fill and text ink of an added or removed diff line. */
  added: { fill: string; ink: string };
  removed: { fill: string; ink: string };
}

const colorCache = new WeakMap<ResolvedAppearance, Map<string, CodeColors>>();

/**
 * Token colors and diff bands for a listing drawn on `fill`, each held to 4.5:1 against what it
 * sits on. Bands are shade 100 of green and red (shade 900 on a dark theme).
 */
export function codeColors(look: ResolvedAppearance, fill: string, ink: string): CodeColors {
  let byFill = colorCache.get(look);
  if (!byFill) colorCache.set(look, (byFill = new Map()));
  const key = fill + ink;
  const known = byFill.get(key);
  if (known) return known;
  const picks = TOKEN_FAMILIES[look.theme] ?? TOKEN_FAMILIES.drafting;
  const tokens = Object.fromEntries(
    TOKEN_CLASSES.map(cls => {
      const [family, shade] = picks[cls];
      return [cls, ensureContrast(swatchFor(look, family, shade).fill, fill, TOKEN_CONTRAST)];
    }),
  ) as Record<TokenClass, string>;
  const band = (family: string) => {
    const f = swatchFor(look, family, look.dark ? 900 : 100).fill;
    return { fill: f, ink: ensureContrast(ink, f, TOKEN_CONTRAST) };
  };
  const out = { tokens, added: band('green'), removed: band('red') };
  byFill.set(key, out);
  return out;
}

/** A run of a row in one color; `cls` is unset for plain text. */
export interface ColoredRun extends CodeRun {
  cls?: TokenClass;
}

/** Split a row's runs at token edges, so each piece draws in one color. */
export function coloredRuns(
  row: CodeRow,
  runs: CodeRun[],
  line: LineTokens | undefined,
): ColoredRun[] {
  if (!line?.tokens.length) return runs;
  const out: ColoredRun[] = [];
  for (const run of runs) {
    const from = run.col - row.col + row.from,
      to = from + run.text.length;
    // The `…` of a clipped row is not source text.
    if (from >= row.to) {
      out.push(run);
      continue;
    }
    let at = from;
    for (const t of line.tokens) {
      if (t.to <= at || t.from >= to) continue;
      if (t.from > at)
        out.push({ col: run.col + at - from, text: run.text.slice(at - from, t.from - from) });
      const end = Math.min(t.to, to);
      out.push({
        col: run.col + Math.max(t.from, at) - from,
        text: run.text.slice(Math.max(t.from, at) - from, end - from),
        cls: t.cls,
      });
      at = end;
    }
    if (at < to) out.push({ col: run.col + at - from, text: run.text.slice(at - from) });
  }
  return out;
}
