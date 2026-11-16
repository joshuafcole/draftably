import { describe, expect, it } from 'vitest';
import * as lib from '../src/lib';
import {
  CONFIG_KEYS,
  ENGINE_PARAMS,
  LANGUAGE,
  THEME_ATTRS,
  type AttributeValue,
  type LanguageAttribute,
  type LanguageStatement,
  parseModel,
} from '../src/lib';

/** Boxes and lines the samples below point at. */
const CONTEXT = [
  'node a "A"',
  'node b "B"',
  'group g "G"',
  'node c "C" in=g',
  'edge e a -> b "calls"',
].join('\n');

/**
 * One line of each statement that parses with no attributes. A statement the table gains without a
 * sample here fails the type check.
 */
const SAMPLES: Record<LanguageStatement, string> = {
  diagram: 'diagram "Title"',
  compare: 'compare "Before" "After"',
  config: 'config editor=zed',
  state: 'state s "S" a',
  phase: 'layout root sequence\nphase p "P" e',
  'was-order': 'layout root sequence\nwas-order e',
  subtitle: 'subtitle "Sub"',
  node: '~node n "N" was="M"',
  group: '~group h "H" was="I"',
  edge: '~edge f b -> a was="old"',
  layout: 'layout root flow',
  theme: 'theme drafting',
  'theme-color': 'theme-color blue shade=500 fill="#112233"',
  legend: 'legend blue "Blue things"',
  note: 'note n1 "A note" near=a',
  footnote: 'footnote 1 "A footnote"',
  routing: 'routing clearance=8',
  bundle: 'bundle a b "trunk"',
  route: 'route e via=10,10',
  label: 'label e at=0.5',
  order: 'order root a b',
  align: 'align x a b',
  near: 'near b a',
  nudge: 'nudge a',
  stay: 'stay a',
  pin: 'pin a',
  size: 'size a',
};

/** A value of each open kind. Some are out of range for some attributes; see `notUnknown`. */
const OPEN: Record<Exclude<AttributeValue, readonly string[]>, string> = {
  number: '1',
  text: '"x"',
  id: 'a',
  ids: 'a,b',
  color: 'blue',
  shade: '500',
  hex: '"#112233"',
  count: '3',
  span: '2',
  height: 'auto',
  pair: '1,2',
  points: '1,2;3,4',
};

const statements = Object.keys(LANGUAGE) as LanguageStatement[];
const attrsOf = (s: LanguageStatement) =>
  Object.entries(LANGUAGE[s].attrs) as Array<[string, AttributeValue]>;
const sample = (s: LanguageStatement, extra = '') => `${CONTEXT}\n${SAMPLES[s]}${extra}\n`;
const valueFor = (v: AttributeValue) => (typeof v === 'string' ? OPEN[v] : v[0]);
const layoutWarnings = (source: string) =>
  parseModel(source).warnings.filter(w => w.code === 'layout-attribute');

/** Parses `source`, or fails, but never because `command` doesn't take `attr`. */
function notUnknown(source: string, command: string, attr: string) {
  try {
    parseModel(source);
  } catch (error) {
    expect(String(error)).not.toContain(`Unknown ${command} attribute: ${attr}.`);
  }
}

describe('the language table', () => {
  it('has a statement for each line the parser reads, and each sample parses', () => {
    for (const s of statements) expect(() => parseModel(sample(s)), s).not.toThrow();
  });

  it('is what the parser refuses: a statement it does not list is unknown', () => {
    expect(() => parseModel('frobnicate a')).toThrow('Unknown statement frobnicate.');
    expect(() => parseModel('toString a')).toThrow('Unknown statement toString.');
  });

  it('is read by the parser: an attribute added to the table is accepted, and gone is refused', () => {
    const nudge = LANGUAGE.nudge.attrs as Record<string, AttributeValue>;
    const source = `${CONTEXT}\nnudge a dx=4 dz=1\n`;
    expect(() => parseModel(source)).toThrow('Unknown nudge attribute: dz.');
    nudge.dz = 'number';
    try {
      expect(parseModel(source).hints).toContainEqual(expect.objectContaining({ dx: 4 }));
    } finally {
      delete nudge.dz;
    }
    expect(() => parseModel(source)).toThrow('Unknown nudge attribute: dz.');
  });

  it('accepts every attribute it lists, on every statement', () => {
    for (const s of statements) {
      if (s === 'layout') continue;
      for (const [attr, value] of attrsOf(s))
        notUnknown(sample(s, ` ${attr}=${valueFor(value)}`), s, attr);
    }
  });

  it('refuses an attribute it does not list, with the diagnostic it always gave', () => {
    for (const s of statements) {
      if (s === 'layout') continue;
      expect(() => parseModel(sample(s, ' bogus=1')), s).toThrow(`Unknown ${s} attribute: bogus.`);
    }
    // A layout line only moves things, so it warns and ignores the attribute instead.
    expect(layoutWarnings(sample('layout', ' bogus=1')).map(w => w.message)).toEqual([
      'This layout line does not take bogus=, so it is ignored. draftably skill print lists the layout settings.',
    ]);
  });

  it('puts a layout line together from its forms, and they cover its attributes', () => {
    const { forms, attrs } = LANGUAGE.layout;
    expect(new Set(Object.values(forms).flat())).toEqual(new Set(Object.keys(attrs)));
    // A number in range for each: an engine setting's least, and the defaults of the rest.
    const IN_RANGE: Record<string, string> = { gap: '28', 'unit-width': '24' };
    const value = (k: string) => {
      const p = ENGINE_PARAMS[k];
      if (p && 'min' in p) return String(p.min);
      return IN_RANGE[k] ?? valueFor(attrs[k as keyof typeof attrs]);
    };
    const line = (head: string, keys: readonly string[]) =>
      `${CONTEXT}\nnode d "D" in=g\n${head} ${keys.map(k => `${k}=${value(k)}`).join(' ')}\n`;
    const taken = {
      'layout root engine=layered': [...forms.engine.slice(1), ...forms.common, ...forms.root],
      'layout g flow': [...forms.recipe, ...forms.flow, ...forms.common],
      'layout root row': [...forms.recipe, ...forms.common, ...forms.root],
      'layout g cells': [...forms.cells, ...forms.common],
    };
    // `root=` names a box, which the engine must find; the context has one called `a`.
    for (const [head, keys] of Object.entries(taken))
      expect(layoutWarnings(line(head, keys)), head).toEqual([]);
    // And what one form takes, another does not.
    expect(layoutWarnings(line('layout g row', ['fold', 'fit', 'columns']))).toHaveLength(3);
    expect(layoutWarnings(line('layout root engine=layered', ['gap']))).toHaveLength(1);
  });

  it('gives each form of a legend line its own attributes', () => {
    const { forms } = LANGUAGE.legend;
    expect(new Set(Object.values(forms).flat())).toEqual(
      new Set(Object.keys(LANGUAGE.legend.attrs)),
    );
    expect(() => parseModel('legend line dashed "Async" shade=500')).toThrow(
      'Unknown legend attribute: shade.',
    );
  });

  it('accepts each word of every closed vocabulary, and refuses a word outside it', () => {
    for (const s of statements) {
      if (s === 'layout' || s === 'config') continue;
      for (const [attr, value] of attrsOf(s)) {
        if (typeof value === 'string') continue;
        // A word may still break a rule of another statement (a marker sits between cells), but
        // never the vocabulary's own.
        for (const word of value) {
          notUnknown(sample(s, ` ${attr}=${word}`), s, attr);
          try {
            parseModel(sample(s, ` ${attr}=${word}`));
          } catch (error) {
            expect(String(error), `${s} ${attr}=${word}`).not.toContain(`Expected ${attr}=`);
          }
        }
        expect(() => parseModel(sample(s, ` ${attr}=bogus`)), `${s} ${attr}`).toThrow(
          `Expected ${attr}=${value.join('|')}; got bogus.`,
        );
      }
    }
  });

  it('reads the layout and config vocabularies from the table', () => {
    for (const fit of LANGUAGE.layout.attrs.fit)
      expect(parseModel(`${CONTEXT}\nlayout root flow fit=${fit}`).layouts[0].fit).toBe(fit);
    for (const editor of LANGUAGE.config.attrs.editor)
      expect(parseModel(`config editor=${editor}`).appearance.config?.editor).toBe(editor);
    expect(() => parseModel('config editor=bogus')).toThrow(
      `Expected editor=${LANGUAGE.config.attrs.editor.join('|')}; got bogus.`,
    );
    for (const engine of LANGUAGE.layout.attrs.engine)
      expect(() => parseModel(`${CONTEXT}\nlayout root engine=${engine}`)).not.toThrow();
  });

  it('reads the closed positional words from the table', () => {
    for (const name of LANGUAGE.theme.words.name)
      expect(parseModel(`theme ${name}`).appearance.theme).toBe(name);
    expect(() => parseModel('theme bogus')).toThrow(
      `Unknown theme bogus; use ${LANGUAGE.theme.words.name.join(', ')}.`,
    );
    for (const style of LANGUAGE.legend.words.line)
      expect(parseModel(`legend line ${style} "x"`).appearance.legend).toEqual([
        { line: style, label: 'x' },
      ]);
    for (const axis of LANGUAGE.align.words.axis)
      expect(parseModel(`${CONTEXT}\nalign ${axis} a b`).hints[0]).toMatchObject({ axis });
    expect(() => parseModel(`${CONTEXT}\nalign z a b`)).toThrow('Expected align x or align y.');
    // Lanes put every box in a top-level group, and cells lay out a group.
    const lanes = 'group l "L"\nnode x "X" in=l';
    for (const recipe of LANGUAGE.layout.words.recipe) {
      const source =
        recipe === 'lanes'
          ? `${lanes}\nlayout root lanes`
          : `${CONTEXT}\nlayout ${recipe === 'cells' ? 'g' : 'root'} ${recipe}`;
      expect(parseModel(source).layouts[0].algorithm, recipe).toBe(recipe);
    }
    expect(() => parseModel(`${CONTEXT}\nlayout root bogus`)).toThrow(
      'The bogus recipe is not supported',
    );
  });

  it('takes a change mark only on the statements it marks', () => {
    for (const s of statements) {
      const marked = 'marks' in LANGUAGE[s];
      const source = `${CONTEXT}\n+${SAMPLES[s].replace(/^~/, '').replace(/ was="[^"]*"/, '')}\n`;
      if (marked) expect(() => parseModel(source), s).not.toThrow();
      else
        expect(() => parseModel(source), s).toThrow(
          'Only node, group and edge lines take a + mark.',
        );
    }
  });

  it('names the settings tables its config and theme attributes come from', () => {
    expect(Object.keys(LANGUAGE.config.attrs).sort()).toEqual(Object.keys(CONFIG_KEYS).sort());
    expect(Object.keys(LANGUAGE.theme.attrs).sort()).toEqual(Object.keys(THEME_ATTRS).sort());
  });
});

describe('the library entry', () => {
  it('exports the table and the vocabularies it is built from', () => {
    expect(lib.LANGUAGE.edge.attrs.head).toBe(lib.MARKERS);
    expect(lib.LANGUAGE.note.attrs.side).toBe(lib.NOTE_SIDES);
    expect(lib.LANGUAGE.theme.words.name).toBe(lib.THEME_IDS);
    expect(lib.LANGUAGE.node.attrs.shape).toBe(lib.DSL_SHAPES);
    expect(lib.LANGUAGE.layout.attrs.engine).toBe(lib.ENGINES);
    expect(lib.LANGUAGE.layout.attrs.fit).toEqual(Object.keys(lib.FITS));
    expect(Object.keys(lib.LANGUAGE.routing.attrs)).toEqual(Object.keys(lib.ROUTING_PARAMS));
    expect(Object.keys(lib.ENGINE_PARAMS).every(k => k in lib.LANGUAGE.layout.attrs)).toBe(true);
    expect(Object.keys(lib.MARKS)).toEqual(['+', '-', '~', '.']);
    expect(lib.CONFIG_KEYS).toBe(CONFIG_KEYS);
    expect(lib.THEME_ATTRS).toBe(THEME_ATTRS);
  });
});

describe('the table as types', () => {
  it('names each statement and attribute as a literal, so a host table must place every one', () => {
    // A host's coverage table is a mapped type over the language: leaving out an attribute, or
    // naming one the language does not have, fails the type check.
    type Covered<S extends LanguageStatement> = Record<LanguageAttribute<S>, true>;
    const edge: Covered<'edge'> = {
      kind: true,
      from: true,
      to: true,
      was: true,
      constraint: true,
      directed: true,
      head: true,
      tail: true,
    };
    // @ts-expect-error `tail` has no entry.
    const missing: Covered<'edge'> = { ...edge, tail: undefined };
    // @ts-expect-error `colour` is not an edge attribute.
    const extra: Covered<'edge'> = { ...edge, colour: true };
    const routing: Covered<'routing'>['hops'] = true;
    const layout: Array<LanguageAttribute<'layout'>> = ['rank-gap', 'fit', 'engine', 'gap'];
    expect([edge, missing, extra, routing, layout].length).toBe(5);
    expect(Object.keys(edge).sort()).toEqual(Object.keys(LANGUAGE.edge.attrs).sort());
  });
});
