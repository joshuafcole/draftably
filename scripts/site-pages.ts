/**
 * Writes a static HTML page for each site route into dist-site/, after `vite build`. Link
 * previews and search crawlers do not run the app, so each page carries its own title,
 * description and social card in plain HTML. It also lets GitHub Pages serve deep links with a
 * 200 instead of the 404.html fallback. Run by `pnpm site:build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-site');
const base = process.env.SITE_BASE ?? '/draftably/';
// Social cards need absolute URLs. Set SITE_ORIGIN with the custom domain.
const origin = process.env.SITE_ORIGIN ?? 'https://byronwall.github.io';

interface Meta {
  path: string;
  title: string;
  description: string;
  /** For a moved page: the new page's path, as its canonical URL. Left out of the sitemap. */
  movedTo?: string;
}

const SITE: Meta[] = [
  {
    path: '',
    title: 'draftably: diagrams from plain text',
    description:
      'A text language and CLI for diagrams. Write plain .draft source; draftably lays out the boxes and routes the lines. Drag a box to keep the move.',
  },
  {
    path: 'play',
    title: 'Playground · draftably',
    description:
      'Write .draft source and watch the diagram redraw as you type. Share a link, download SVG or PNG, or drop an exported diagram to keep editing.',
  },
  {
    path: 'docs',
    title: 'Docs · draftably',
    description:
      'The draftably language, CLI, themes and agent skill, with live examples you can edit.',
  },
];

/** At most about 150 characters, ending on a word: previews cut longer text. */
const clip = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 150) return flat;
  return `${flat.slice(0, 147).replace(/\s+\S*$/, '')}…`;
};

async function docsPages(): Promise<Meta[]> {
  // The docs read DSL.md and their pages through Vite (`?raw`, globs), so load them the same way.
  const server = await createServer({
    configFile: path.join(root, 'vite.site.config.ts'),
    server: { middlewareMode: true },
    // Only modules load here; scanning client dependencies would outlive the server.
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  try {
    const docs = await server.ssrLoadModule('/docs/content.ts');
    const pages: Meta[] = docs.PAGES.map(
      (p: {
        slug: string;
        title: string;
        lead: string;
        tokens: { type: string; text?: string }[];
      }) => {
        const first = p.lead || p.tokens.find(t => t.type === 'paragraph')?.text || p.title;
        return {
          path: `docs/${p.slug}`,
          title: `${p.title} · draftably docs`,
          description: clip(docs.plain(first)),
        };
      },
    );
    // An old path gets a page too, so it answers 200; the app then routes it to the new page.
    const moved = Object.entries(docs.MOVED as Record<string, string>).map(([from, to]) => {
      const target = pages.find(p => p.path === `docs/${to}`)!;
      return { ...target, path: `docs/${from}`, movedTo: target.path };
    });
    return [...pages, ...moved];
  } finally {
    await server.close();
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Pages serves each route from its folder and redirects the bare path to it with a slash.
const urlOf = (meta: Meta) => {
  const p = meta.movedTo ?? meta.path;
  return `${origin}${base}${p ? `${p}/` : ''}`;
};

/** The page's text before the app runs. One line, so a second run can find and replace it. */
function staticBody(meta: Meta) {
  const links = [
    [`${base}app/`, 'Editor'],
    [`${base}play/`, 'Playground'],
    [`${base}docs/`, 'Docs'],
    ['https://www.npmjs.com/package/draftably', 'npm'],
    ['https://github.com/byronwall/draftably', 'GitHub'],
  ].map(([href, text]) => `<a href="${href}">${text}</a>`);
  return `<div class="page"><main class="hero"><h1>${esc(meta.title.split(' · ')[0])}</h1><p class="hero-sub">${esc(meta.description)}</p><p class="footer-links">${links.join(' ')}</p></main></div>`;
}

function page(template: string, meta: Meta) {
  const url = urlOf(meta);
  const image = `${origin}${base}og.png`;
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="draftably" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="draftably source beside the diagram it draws" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="theme-color" content="#f5f6f9" />`,
  ].join('\n    ');
  return template
    .replace(/<title>[^<]*<\/title>/, '')
    .replace(/<meta\s+name="description"[^>]*\/>/, '')
    .replace('</head>', `    ${tags}\n  </head>`)
    .replace(/<div id="root">.*<\/div>/, () => `<div id="root">${staticBody(meta)}</div>`);
}

// Strip tags a previous run added, so running this twice on one build gives the same pages.
const template = fs
  .readFileSync(path.join(out, 'index.html'), 'utf8')
  .split('\n')
  .filter(line => !/(property="og:|name="twitter:|rel="canonical"|name="theme-color")/.test(line))
  .join('\n');
const all = [...SITE, ...(await docsPages())];
for (const meta of all) {
  const file = path.join(out, meta.path, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, page(template, meta));
}
// Unknown paths still load the app, under the site's own card.
fs.writeFileSync(path.join(out, '404.html'), page(template, SITE[0]));
const urls = all
  .filter(meta => !meta.movedTo)
  .map(meta => `  <url><loc>${esc(urlOf(meta))}</loc></url>`)
  .join('\n');
fs.writeFileSync(
  path.join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
);
console.log(`Wrote ${all.length} pages with social tags, and sitemap.xml.`);
