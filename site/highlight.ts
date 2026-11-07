/**
 * Syntax highlighting for `.draft` source, shared by every code view on the site. It follows the
 * parser's lexical rules (src/dsl/syntax.ts): a line is a command, ids, quoted strings and
 * `key=value` attributes, and `#` or `//` starts a comment outside quotes.
 */

/** Every command the parser accepts. tests/site-highlight.test.ts keeps this list complete. */
export const COMMANDS = [
  'diagram',
  'subtitle',
  'compare',
  'config',
  'state',
  'phase',
  'was-order',
  'node',
  'group',
  'edge',
  'layout',
  'theme',
  'theme-color',
  'legend',
  'note',
  'footnote',
  'bundle',
  'routing',
  'order',
  'align',
  'near',
  'nudge',
  'stay',
  'pin',
  'size',
  'view',
  'snapshot',
  'box',
];

const COMMAND_SET = new Set(COMMANDS);
const MARKS = new Set(['+', '-', '~', '.']);

export type TokenKind =
  | 'command'
  | 'mark'
  | 'id'
  | 'string'
  | 'arrow'
  | 'attr'
  | 'value'
  | 'number'
  | 'comment'
  | 'space';

export interface Token {
  text: string;
  kind: TokenKind;
}

/** Split one source line into tokens; joining their text gives the line back. */
export function tokenizeLine(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let first = true;
  const push = (t: string, kind: TokenKind) => t && out.push({ text: t, kind });
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      const start = i;
      while (i < text.length && /\s/.test(text[i])) i++;
      push(text.slice(start, i), 'space');
      continue;
    }
    if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      push(text.slice(i), 'comment');
      break;
    }
    // A word runs to the next space outside quotes.
    const start = i;
    let quote = false;
    while (i < text.length && (quote || !/\s/.test(text[i]))) {
      if (text[i] === '\\' && quote) i++;
      else if (text[i] === '"') quote = !quote;
      i++;
    }
    const word = text.slice(start, i);
    if (first) {
      first = false;
      const marked = MARKS.has(word[0]) && word.length > 1 && COMMAND_SET.has(word.slice(1));
      if (marked) {
        push(word[0], 'mark');
        push(word.slice(1), 'command');
      } else push(word, COMMAND_SET.has(word) ? 'command' : 'id');
      continue;
    }
    const eq = word.indexOf('=');
    if (eq > 0 && !word.startsWith('"')) {
      push(word.slice(0, eq), 'attr');
      push('=', 'attr');
      const value = word.slice(eq + 1);
      push(value, value.startsWith('"') ? 'string' : /^-?\d/.test(value) ? 'number' : 'value');
    } else if (word.startsWith('"')) push(word, 'string');
    else if (/^[-<]*[-=.]+[>]*$/.test(word) && word.length > 1) push(word, 'arrow');
    else if (/^-?\d+(\.\d+)?$/.test(word)) push(word, 'number');
    else push(word, 'id');
  }
  return out;
}

const MARK_NAMES: Record<string, string> = {
  '+': 'added',
  '-': 'removed',
  '~': 'changed',
  '.': 'context',
};

/** The CSS classes for a token; change marks also name their kind of change. */
export const tokenClass = (t: Token) =>
  t.kind === 'mark' ? `tok-mark tok-mark-${MARK_NAMES[t.text]}` : `tok-${t.kind}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Highlighted HTML for source, one `<span class="tok-…">` per token and `\n` between lines. */
export function highlightHtml(source: string): string {
  return source
    .split('\n')
    .map(line =>
      tokenizeLine(line)
        .map(t =>
          t.kind === 'space' ? esc(t.text) : `<span class="${tokenClass(t)}">${esc(t.text)}</span>`,
        )
        .join(''),
    )
    .join('\n');
}
