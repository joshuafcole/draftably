import { describe, expect, it } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { checkSource } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import {
  contrast,
  defaultAppearance,
  resolveAppearance,
  swatchFor,
  THEME_IDS,
  type ThemeId,
} from '../src/model/appearance';
import { codeColors, TOKEN_CLASSES, tokenize, type LineTokens } from '../src/model/highlight';

/** `cls[text]` for each token of each line, to read a lexer's output at a glance. */
const show = (lines: string[], out: LineTokens[] | undefined) =>
  out!.map((l, i) =>
    [l.line ?? '', ...l.tokens.map(t => `${t.cls}[${lines[i].slice(t.from, t.to)}]`)]
      .join(' ')
      .trim(),
  );

describe('code token colors', () => {
  it('hold 4.5:1 against the code fill and the diff bands in every theme', () => {
    for (const theme of [...THEME_IDS, 'drafting-dark'] as ThemeId[]) {
      const look = resolveAppearance({ ...defaultAppearance(), theme });
      // The default code fill, and a colored listing's shade 50 (950 on a dark theme).
      for (const s of [look.node, swatchFor(look, 'blue', look.dark ? 950 : 50)]) {
        const c = codeColors(look, s.fill, s.ink);
        for (const cls of TOKEN_CLASSES)
          expect(contrast(c.tokens[cls], s.fill), `${theme} ${cls}`).toBeGreaterThanOrEqual(4.5);
        for (const band of [c.added, c.removed])
          expect(contrast(band.ink, band.fill), `${theme} band`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('lexers', () => {
  it('colors SQL keywords, functions, strings and comments, and leaves names plain', () => {
    const lines = [
      'SELECT count(*) AS n, s.name FROM t AS s -- x',
      "WHERE s.kind = 'a''b' AND n > 2.5",
    ];
    expect(show(lines, tokenize('sql', lines))).toEqual([
      'keyword[SELECT] function[count] punctuation[(] operator[*] punctuation[)] keyword[AS] punctuation[,] punctuation[.] keyword[FROM] keyword[AS] comment[-- x]',
      "keyword[WHERE] punctuation[.] operator[=] string['a''b'] keyword[AND] operator[>] number[2.5]",
    ]);
  });

  it('marks diff lines and keeps file headers apart from removed lines', () => {
    const lines = ['--- a/x.py', '+++ b/x.py', '@@ -1 +1 @@', '-old', '+new', ' same'];
    expect(tokenize('diff', lines)!.map(l => l.line ?? l.tokens[0]?.cls ?? '')).toEqual([
      'comment',
      'comment',
      'hunk',
      'removed',
      'added',
      '',
    ]);
  });

  it('reads YAML keys, scalars, comments and block scalars', () => {
    const lines = [
      'env:',
      '  - name: LOG # see |',
      '    on: true',
      '    run: |',
      '      echo "x: y"',
      'n: 3',
    ];
    expect(show(lines, tokenize('yaml', lines))).toEqual([
      'keyword[env] punctuation[:]',
      'punctuation[-] keyword[name] punctuation[:] comment[# see |]',
      'keyword[on] punctuation[:] keyword[true]',
      'keyword[run] punctuation[:] operator[|]',
      'string[echo "x: y"]',
      'keyword[n] punctuation[:] number[3]',
    ]);
  });

  it('separates JSON keys from string values', () => {
    const lines = ['{ "a": "b", "n": [1, true] }'];
    expect(show(lines, tokenize('json', lines))).toEqual([
      'punctuation[{] keyword["a"] punctuation[:] string["b"] punctuation[,] keyword["n"] punctuation[:] punctuation[[] number[1] punctuation[,] keyword[true] punctuation[]] punctuation[}]',
    ]);
  });

  it('leaves what it cannot follow plain: TS regex literals, nested shell quoting, heredocs as strings', () => {
    const ts = ['if (a || /^4\\d$/.test(s)) f(`x${y}`);'];
    expect(show(ts, tokenize('ts', ts))).toEqual([
      'keyword[if] punctuation[(] operator[||] punctuation[.] function[test] punctuation[(] punctuation[)] punctuation[)] function[f] punctuation[(] string[`x] string[`] punctuation[)] punctuation[;]',
    ]);
    const sh = [
      'out="$(date "+%F")" # c',
      'cat <<EOF | sort',
      "it's",
      'EOF',
      // Not heredocs: arithmetic, quoted text, and an operator with no closing line.
      'echo $((1<<n)) "<<END" <<NEVER',
      'ls',
    ];
    expect(show(sh, tokenize('sh', sh))).toEqual([
      'operator[=] comment[# c]',
      'function[cat] operator[<<] operator[|] function[sort]',
      "string[it's]",
      'punctuation[EOF]',
      'function[echo] punctuation[$((] operator[1<<] punctuation[)] punctuation[)] string["<<END"] operator[<<]',
      'function[ls]',
    ]);
  });

  it('lexes a long run of digits in linear time', () => {
    const line = ['1'.repeat(5000) + 'x'],
      start = performance.now();
    for (const lang of ['sql', 'python', 'ts']) expect(tokenize(lang, line)![0].tokens).toEqual([]);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('draws plain text for an unknown language', () => {
    expect(tokenize('cobol', ['MOVE A TO B'])).toBeUndefined();
  });
});

describe('code colors in SVG', () => {
  it('draws token fills and a band behind each row of a wrapped diff line', () => {
    const doc = projectScene(
      checkSource(`node d shape=code lang=diff max-width=200 <<D\n+${'x '.repeat(60)}\nD\n`),
    );
    const svg = renderSvg(doc);
    const look = resolveAppearance(doc.appearance);
    const band = swatchFor(look, 'green', 100).fill;
    const rect = new RegExp(`<rect [^>]*height="(\\d+)" fill="${band}"`).exec(svg);
    expect(Number(rect?.[1])).toBeGreaterThan(17 * 3);
  });
});
