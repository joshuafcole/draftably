/**
 * The docs' pages. The language reference is `docs/DSL.md`, split into one page per `##` section;
 * the guides are the Markdown files in `pages/`. Both are parsed here once, with `marked`, into
 * tokens the page renders, the headings for its contents list, and the text search reads.
 */
import { Marked, Renderer, type Token, type Tokens } from 'marked';
import { THEME_IDS } from '../../src/model/appearance';
import dsl from '../../docs/DSL.md?raw';
import { COMMANDS, highlightHtml } from '../highlight';

export const GITHUB = 'https://github.com/byronwall/draftably';
const BASE = import.meta.env.BASE_URL;

export interface Heading {
  id: string;
  text: string;
  depth: number;
}

export interface Page {
  slug: string;
  title: string;
  group: string;
  /** The first paragraph, shown under the title. */
  lead: string;
  tokens: Token[];
  headings: Heading[];
  /** Every `.draft` source the page draws, so it can be drawn before the page shows. */
  drafts: string[];
  /** Where to edit the Markdown on GitHub. */
  source: string;
}

/** Sidebar groups, in order. A DSL section missing here goes at the end of Language. */
const GROUPS: [string, string[]][] = [
  ['Start', ['start', 'get-started', 'recipes', 'saving']],
  [
    'Use Draftably',
    [
      'cli',
      'command-line',
      'editing-in-the-viewer',
      'shortcuts',
      'themes',
      'import',
      'agent-skill',
      'examples',
    ],
  ],
  [
    'Language',
    [
      'overview',
      'rules',
      'refinements',
      'themes-and-colors',
      'soft-groups',
      'change-marks',
      'emphasis-states',
    ],
  ],
  ['Diagram kinds', ['swim-lanes', 'sequence-diagrams', 'cells']],
  ['Layout', ['layout-engines', 'routing', 'layout-tools']],
  [
    'Embed in an app',
    [
      'embed',
      'embed-quick-start',
      'react',
      'solid',
      'vue',
      'svelte',
      'plain-html',
      'editor-component',
    ],
  ],
  [
    'Embedding topics',
    [
      'embed-concepts',
      'content-on-nodes',
      'camera-and-geometry',
      'events-and-status',
      'theming',
      'server-rendering',
      'performance',
      'troubleshooting',
      'upgrade',
      'api-reference',
    ],
  ],
  ['Graph layout', ['your-app-draws', 'layout-api', 'layout-drop-in']],
  [
    'Docs and Markdown',
    [
      'from-mermaid',
      'render-svg',
      'markdown',
      'documentation-sites',
      'github-action',
      'build-an-adapter',
      'support',
    ],
  ],
  ['Project', ['agent-diagram-evaluation']],
];

/** Sidebar titles that differ from the section's heading. */
const TITLES: Record<string, string> = {
  'command-line': 'CLI reference',
  'editing-in-the-viewer': 'Using the Editor',
};

/** A first line for pages that share a subject, to say which one does what. */
const PAIRED: Record<string, string> = {
  cli: 'This guide shows each command in use. The [CLI reference](#command-line) lists them all and explains variants, conflicts and exports.',
  themes:
    'This guide shows the presets and how to pick one. [Themes and colors](#themes-and-colors) is the reference for the lines that set them.',
  'themes-and-colors':
    'This page is the reference for `theme`, `theme-color` and `legend` lines. To compare the presets, read the [Themes guide](#themes).',
};

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');

/** Text without Markdown marks, for headings and search. */
export const plain = (md: string) =>
  md
    .replace(/```[^\n]*\n/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_|]/g, '')
    .replace(/^#+ /gm, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Each theme's copy of a ```draft themes block. */
export const themed = (source: string) =>
  THEME_IDS.map(id => ({ id, source: `theme ${id}\n${source}` }));

const isDraft = (t: Token): t is Tokens.Code => t.type === 'code' && /^draft\b/.test(t.lang ?? '');

function makePage(slug: string, title: string, md: string, source: string): Page {
  const tokens = new Marked().lexer(md);
  // A guide starts with `# Title`; a DSL section with `## Title` and `###` below it.
  const top = tokens.find((t): t is Tokens.Heading => t.type === 'heading');
  const shift = top ? top.depth - 1 : 0;
  const body: Token[] = [];
  const headings: Heading[] = [];
  const seen = new Set<string>();
  let lead = '';
  for (const t of tokens) {
    if (t === top) continue;
    if (t.type === 'heading') {
      t.depth -= shift;
      let id = slugify(t.text);
      while (seen.has(id)) id += '-';
      seen.add(id);
      (t as Tokens.Heading & { id: string }).id = id;
      if (t.depth <= 3) headings.push({ id, text: plain(t.text), depth: t.depth });
    }
    // A short first paragraph is the page's lead; a long one stays body text.
    const first = !lead && t.type === 'paragraph' && !body.some(b => b.type !== 'space');
    if (first && t.text.length <= 220) lead = t.text;
    else body.push(t);
  }
  const drafts = body
    .filter(isDraft)
    .flatMap(t => (t.lang === 'draft themes' ? themed(t.text).map(v => v.source) : [t.text]));
  const name = TITLES[slug] ?? title;
  if (PAIRED[slug]) lead = `${PAIRED[slug]} ${lead}`.trim();
  return { slug, title: name, group: '', lead, tokens: body, headings, drafts, source };
}

function dslPages(): Page[] {
  const parts = dsl.split(/^(?=## )/m);
  const intro = parts.shift()!.replace(/^# .*\n/, '');
  const file = `${GITHUB}/edit/main/docs/DSL.md`;
  const pages = [makePage('overview', 'Overview', intro, file)];
  for (const part of parts) {
    const title = plain(part.slice(3, part.indexOf('\n')));
    pages.push(makePage(slugify(title), title, part, file));
  }
  return pages;
}

const guides = import.meta.glob<string>('./pages/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

function guidePages(): Page[] {
  return Object.entries(guides).map(([file, md]) => {
    const slug = file.replace(/^.*\//, '').replace(/\.md$/, '');
    const source = `${GITHUB}/edit/main/site/docs/pages/${slug}.md`;
    return makePage(slug, plain(/^# (.*)$/m.exec(md)?.[1] ?? slug), md, source);
  });
}

function ordered(): Page[] {
  const all = new Map([...guidePages(), ...dslPages()].map(p => [p.slug, p]));
  const out: Page[] = [];
  for (const [group, slugs] of GROUPS)
    for (const slug of slugs) {
      const page = all.get(slug);
      if (!page) continue;
      page.group = group;
      out.push(page);
      all.delete(slug);
    }
  for (const page of all.values()) {
    page.group = 'Language';
    const last = out.findLastIndex(p => p.group === 'Language');
    out.splice(last + 1, 0, page);
  }
  return out;
}

export const PAGES = ordered();
/** The docs home: it only routes to other pages. */
export const HOME = 'start';
export const findPage = (slug: string) => PAGES.find(p => p.slug === slug);
/**
 * Pages that moved, by old slug. Links from released READMEs still use them, so the router sends
 * an old path on: to the heading or page its `#anchor` names, or else to the new page.
 */
export const MOVED: Record<string, string> = { frameworks: 'embed', element: 'embed-concepts' };
export const docsPath = (slug: string, hash = '') => `/docs/${slug}${hash ? `#${hash}` : ''}`;

/** Where `#anchor` links in the Markdown point: a page, or a heading on one. */
const ANCHORS = new Map<string, string>();
for (const page of PAGES) {
  for (const h of page.headings)
    if (!ANCHORS.has(h.id)) ANCHORS.set(h.id, docsPath(page.slug, h.id));
}
for (const page of PAGES) ANCHORS.set(page.slug, docsPath(page.slug));

/** The docs path for a DSL.md heading anchor, such as `byte-and-bit-layouts`. */
export const anchorPath = (id: string) => ANCHORS.get(id);

/** This site's own address. DSL.md uses it, since `draftably docs` and GitHub also show the file. */
const SITE = 'https://draftably.dev/';

function resolveHref(href: string): string {
  if (href.startsWith(SITE)) href = `/${href.slice(SITE.length)}`;
  if (href.startsWith('#')) {
    const to = ANCHORS.get(href.slice(1));
    return to ? BASE + to.slice(1) : href;
  }
  if (/^[a-z]+:/.test(href)) return href;
  // A page of this site, such as `/play`.
  if (href.startsWith('/')) return BASE + href.slice(1);
  // A repository path, relative to docs/.
  const path = new URL(href, 'https://x/docs/').pathname.slice(1);
  return `${GITHUB}/blob/main/${path}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const COMMAND_SET = new Set(COMMANDS);

/** A `text` block of `.draft` lines, as opposed to CLI output or prose. */
const looksLikeDraft = (text: string) =>
  text
    .split('\n')
    .filter(l => l.trim())
    .every(
      l =>
        /^\s*(#|\/\/)/.test(l) ||
        COMMAND_SET.has(
          l
            .trim()
            .split(/\s/)[0]
            .replace(/^[-+~.]/, ''),
        ),
    );

/** Shell lines with their `# comments` dimmed. */
const shellHtml = (text: string) =>
  text
    .split('\n')
    .map(line => {
      const at = line.search(/(^|\s)#\s/);
      return at < 0
        ? esc(line)
        : esc(line.slice(0, at)) + `<span class="tok-comment">${esc(line.slice(at))}</span>`;
    })
    .join('\n');

const md = new Marked({
  renderer: {
    heading(t) {
      const id = (t as Tokens.Heading & { id?: string }).id ?? slugify(t.text);
      return `<h${t.depth} id="${id}"><a class="doc-anchor" href="#${id}">${this.parser.parseInline(t.tokens)}</a></h${t.depth}>\n`;
    },
    link(t) {
      const href = resolveHref(t.href);
      const external = /^https?:/.test(href) && !href.startsWith(location.origin);
      // The Editor and static downloads must bypass the site's client router.
      const separate = href.startsWith(`${BASE}app/`) || href.startsWith(`${BASE}evaluations/`);
      const attrs = external
        ? ' target="_blank" rel="noreferrer"'
        : separate
          ? ' rel="external"'
          : '';
      return `<a href="${esc(href)}"${attrs}>${this.parser.parseInline(t.tokens)}</a>`;
    },
    image(t) {
      const href = t.href.startsWith('/') ? BASE + t.href.slice(1) : t.href;
      return `<img src="${esc(href)}" alt="${esc(t.text)}" loading="lazy" style="max-width:100%;height:auto" />`;
    },
    code(t) {
      const lang = t.lang ?? '';
      const body =
        /^draft/.test(lang) || (lang === 'text' && looksLikeDraft(t.text))
          ? highlightHtml(t.text)
          : /^(sh|bash)/.test(lang)
            ? shellHtml(t.text)
            : esc(t.text);
      return `<div class="doc-code"><button type="button" class="doc-copy" aria-label="Copy">Copy</button><pre><code>${body}</code></pre></div>\n`;
    },
    table(t) {
      return `<div class="doc-table">${Renderer.prototype.table.call(this, t)}</div>`;
    },
  },
});

/** HTML for a run of tokens. */
export function html(tokens: Token[]): string {
  return md.parser(Object.assign(tokens.slice(), { links: {} }) as Token[]);
}

export const inlineHtml = (text: string) => md.parseInline(text) as string;

export { isDraft };
