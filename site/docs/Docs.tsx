import { A, useLocation, useNavigate, useParams } from '@solidjs/router';
import { Logo } from '../Logo';
import { SiteNav } from '../SiteNav';
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import {
  anchorPath,
  docsPath,
  findPage,
  HOME,
  html,
  inlineHtml,
  isDraft,
  MOVED,
  PAGES,
  type Page,
} from './content';
import { Example, prepare, warm } from './Example';
import { SearchDialog, SearchIcon } from './Search';
import { words } from './find';
import './docs-nav.css';

const BASE = import.meta.env.BASE_URL;
const GROUPS = [...new Set(PAGES.map(p => p.group))];
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** A shell block, with its `#` notes removed: interactive zsh passes them to the command. */
const pasteable = (code: string) =>
  /^(\s*(#.*)?\n)*\s*(draftably|npx|pnpm|npm)\s/.test(code)
    ? code
        .split('\n')
        // Skip quoted text, so a `#` inside quotes stays.
        .map(line => line.replace(/^((?:'[^']*'|"[^"]*"|[^'"])*?)(?:^|\s+)#.*$/, '$1').trimEnd())
        .filter(Boolean)
        .join('\n')
    : code;

// Scroll position per history entry. These listeners live here, and not in a component, so that
// Back from the Playground finds them too.
const scrolls = new Map<number, number>();
const entry = (): number | undefined => history.state?._depth;
const remember = () => {
  const at = entry();
  if (at != null) scrolls.set(at, window.scrollY);
};
let returning: { at?: number; y?: number } = {};
window.addEventListener('scroll', remember, { passive: true });
// Back from another document, such as the Editor, loads this page again, so the entry holds it.
window.addEventListener('pagehide', () => {
  history.replaceState({ ...history.state, y: window.scrollY }, '');
});
const [load] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
if (load?.type === 'back_forward') returning = { at: entry(), y: history.state?.y };
// The new page clamps or resets the scroll, so read the position before it shows.
window.addEventListener('popstate', () => {
  returning = { at: entry(), y: scrolls.get(entry() ?? -1) };
});
/** Where Back or Forward should land, once, or undefined after a new navigation. */
const takeReturn = () => {
  const y = returning.at === entry() ? returning.y : undefined;
  returning = {};
  return y;
};

/** `/docs` and `/docs/<topic>`: sidebar, the page, its contents and search. */
export function Docs() {
  const params = useParams<{ slug?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const slug = () => params.slug?.replace(/\/$/, '') || PAGES[0].slug;
  const [page, setPage] = createSignal<Page>();
  const [missing, setMissing] = createSignal(false);
  const [searching, setSearching] = createSignal(false);
  const [menu, setMenu] = createSignal(false);
  let side!: HTMLElement;
  let menuButton!: HTMLButtonElement;
  const closeMenu = () => {
    setMenu(false);
    menuButton.focus();
  };

  // Draw the next page's examples before swapping it in, so nothing moves once it shows.
  createEffect(
    on(slug, s => {
      const next = findPage(s);
      setMenu(false);
      // A DSL.md heading anchor, such as the playground's help links, opens its page there.
      const anchor = !next && anchorPath(s);
      if (anchor) return navigate(anchor, { replace: true });
      const moved = !next && MOVED[s];
      if (moved) {
        const hash = location.hash.slice(1);
        return navigate((hash && anchorPath(hash)) || docsPath(moved), { replace: true });
      }
      if (!next) {
        document.title = 'No such page · draftably docs';
        return setMissing(true);
      }
      void Promise.all(next.drafts.map(prepare)).then(() => {
        if (slug() !== s) return;
        setMissing(false);
        setPage(next);
        document.title = `${next.title} · draftably docs`;
      });
    }),
  );
  onMount(() => {
    const first = setTimeout(() => warm(PAGES.flatMap(p => p.drafts)), 600);
    onCleanup(() => clearTimeout(first));
  });

  onMount(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setSearching(true);
      } else if (e.key === 'Escape' && menu() && !searching()) {
        closeMenu();
      } else if (e.key === 'Escape' && !typing && !searching() && location.search) {
        // Clear what search marked on the page.
        navigate(`${location.pathname.slice(BASE.length - 1)}${location.hash}`, { replace: true });
      }
    };
    window.addEventListener('keydown', key);
    onCleanup(() => window.removeEventListener('keydown', key));

    // The button goes away on a wide screen, so the open menu must not stay.
    const wide = matchMedia('(min-width: 821px)');
    const widen = () => wide.matches && setMenu(false);
    wide.addEventListener('change', widen);
    onCleanup(() => wide.removeEventListener('change', widen));
  });

  const index = () => PAGES.findIndex(p => p.slug === page()?.slug);
  // The open menu covers the page, so only the menu and its button take focus.
  createEffect(() => {
    const open = menu();
    document.body.classList.toggle('docs-menu-open', open);
    document
      .querySelectorAll('.docs-skip, .docs-top > :not(.docs-menu-button), .docs-main, .docs-toc')
      .forEach(el => el.toggleAttribute('inert', open));
  });
  onCleanup(() => document.body.classList.remove('docs-menu-open'));

  // Keep the current topic in view in a sidebar that scrolls, and in the phone menu as it opens.
  createEffect(() => {
    page();
    menu();
    side.querySelector('.is-current')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });

  return (
    <div class="docs">
      <a
        class="docs-skip"
        href="#docs-content"
        onClick={e => {
          e.preventDefault();
          document.getElementById('docs-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <header class="docs-top">
        <a class="wordmark" href={BASE}>
          <Logo />
          draftably
        </a>
        <button
          type="button"
          class="docs-search-button"
          aria-label="Search docs"
          onClick={() => setSearching(true)}
        >
          <SearchIcon />
          <span>Search docs</span>
          <kbd>{MAC ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <SiteNav current="docs" class="docs-top-links" />
        <button
          ref={menuButton}
          type="button"
          class="docs-menu-button"
          aria-expanded={menu()}
          onClick={() => setMenu(!menu())}
        >
          {menu() ? 'Close' : 'Topics'}
        </button>
      </header>
      <div class="docs-body">
        <nav
          ref={side}
          class="docs-side"
          classList={{ 'is-open': menu() }}
          aria-label="Docs topics"
          onClick={e => (e.target as Element).closest('a') && closeMenu()}
        >
          <For each={GROUPS}>
            {group => (
              <section>
                <h2>{group}</h2>
                <For each={PAGES.filter(p => p.group === group)}>
                  {p => (
                    <A href={docsPath(p.slug)} classList={{ 'is-current': p.slug === slug() }}>
                      {p.title}
                    </A>
                  )}
                </For>
              </section>
            )}
          </For>
        </nav>
        <Show
          when={!missing()}
          fallback={
            <main id="docs-content" class="docs-main" tabindex="-1">
              <article class="doc">
                <h1>No such page</h1>
                <p class="doc-lead">
                  There is no docs page at <code>{location.pathname}</code>.{' '}
                  <button
                    type="button"
                    class="doc-inline-button"
                    onClick={() => setSearching(true)}
                  >
                    Search the docs
                  </button>{' '}
                  or pick a topic from the list.
                </p>
              </article>
            </main>
          }
        >
          <Show when={page()}>
            {p => (
              <>
                <main id="docs-content" class="docs-main" tabindex="-1">
                  <Article page={p()} query={new URLSearchParams(location.search).get('q') ?? ''} />
                  <Pager prev={PAGES[index() - 1]} next={PAGES[index() + 1]} />
                </main>
                <Contents page={p()} />
              </>
            )}
          </Show>
        </Show>
      </div>
      <Show when={searching()}>
        <SearchDialog
          onClose={() => setSearching(false)}
          onPick={(to, query) => {
            setSearching(false);
            navigate(
              `${to.split('#')[0]}?q=${encodeURIComponent(query)}${to.includes('#') ? `#${to.split('#')[1]}` : ''}`,
            );
          }}
        />
      </Show>
    </div>
  );
}

function Article(props: { page: Page; query: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  let el!: HTMLElement;
  let title!: HTMLHeadingElement;

  // Plain HTML runs, with each ```draft block as a live example between them.
  const parts = () => {
    const out: ({ html: string } | { draft: string; themes: boolean })[] = [];
    let run: Page['tokens'] = [];
    const flush = () => run.length && (out.push({ html: html(run) }), (run = []));
    for (const t of props.page.tokens) {
      if (isDraft(t)) {
        flush();
        out.push({ draft: t.text, themes: t.lang === 'draft themes' });
      } else run.push(t);
    }
    flush();
    return out;
  };

  // Scroll once the page is in place: back to where Back left it, or to the hash, or to the top.
  // Then mark what search matched. Only a link within a page animates.
  createEffect(
    on(
      () => [props.page, location.hash, props.query] as const,
      ([page, hash, query], prev) => {
        const back = takeReturn();
        const moved = prev?.[0] !== page;
        const behavior = moved ? 'instant' : 'auto';
        requestAnimationFrame(() => {
          const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
          const first = highlight(el, query);
          if (back != null) window.scrollTo({ top: back, behavior: 'instant' });
          else if (target) target.scrollIntoView({ behavior });
          else if (first) {
            const top = first.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: Math.max(0, top - window.innerHeight / 3), behavior });
          } else window.scrollTo({ top: 0, behavior });
          // A page entered by Back has no scroll event if it stays at 0, and the entry may be old.
          remember();
          if (moved && prev) title.focus({ preventScroll: true });
        });
      },
    ),
  );
  onCleanup(() => CSS.highlights?.delete('search'));

  // Links inside the Markdown stay in the app; code blocks copy.
  const click = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>('.doc-copy');
    if (copy) {
      const code = copy.parentElement?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard.writeText(pasteable(code));
      copy.classList.remove('is-copied');
      void copy.offsetWidth;
      copy.classList.add('is-copied');
      return;
    }
    const a = target.closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href || a.target || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (href.startsWith('#')) {
      e.preventDefault();
      navigate(`${location.pathname.slice(BASE.length - 1)}#${href.slice(1)}`);
    } else if (href.startsWith(`${BASE}docs`)) {
      e.preventDefault();
      navigate(href.slice(BASE.length - 1));
    }
  };

  return (
    <article class="doc" data-page={props.page.slug} ref={el} onClick={click}>
      <div class="doc-crumbs">
        {/* The group links to its first page, unless that is this page. */}
        <Show
          when={PAGES.find(p => p.group === props.page.group)!.slug !== props.page.slug}
          fallback={<span>{props.page.group}</span>}
        >
          <A href={docsPath(PAGES.find(p => p.group === props.page.group)!.slug)}>
            {props.page.group}
          </A>
        </Show>
        <span aria-hidden="true">/</span>
        <span>{props.page.title}</span>
      </div>
      <h1 ref={title} tabindex="-1">
        {props.page.title}
      </h1>
      <OnThisPage page={props.page} />
      <Show when={props.page.lead}>
        {/* eslint-disable-next-line solid/no-innerhtml -- our own Markdown */}
        <p class="doc-lead" innerHTML={inlineHtml(props.page.lead)} />
      </Show>
      <For each={parts()}>
        {part =>
          'html' in part ? (
            // eslint-disable-next-line solid/no-innerhtml -- our own Markdown
            <div class="doc-md" innerHTML={part.html} />
          ) : (
            <Example source={part.draft} themes={part.themes} />
          )
        }
      </For>
    </article>
  );
}

/** Mark every match of the search words in the article, without touching its DOM. */
function highlight(root: HTMLElement, query: string): Range | undefined {
  if (!CSS.highlights) return;
  CSS.highlights.delete('search');
  const terms = words(query);
  if (!terms.length) return;
  const ranges: Range[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    if (node.parentElement?.closest('.doc-drawing, .doc-example-gutter, .doc-onpage, textarea'))
      continue;
    const text = node.textContent!.toLowerCase();
    for (const term of terms)
      for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + term.length)) {
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + term.length);
        ranges.push(range);
      }
  }
  if (ranges.length) CSS.highlights.set('search', new Highlight(...ranges));
  return ranges[0];
}

/** The id of the section in view. */
function sectionInView(page: Page) {
  let id = '';
  for (const h of page.headings) {
    const el = document.getElementById(h.id);
    if (el && el.getBoundingClientRect().top < 120) id = h.id;
  }
  const end = window.innerHeight + window.scrollY >= document.body.scrollHeight - 4;
  return end ? (page.headings.at(-1)?.id ?? id) : id;
}

function SectionLinks(props: { page: Page; current: string }) {
  return (
    <For each={props.page.headings}>
      {h => (
        <A
          href={docsPath(props.page.slug, h.id)}
          classList={{ 'is-current': props.current === h.id, 'is-sub': h.depth > 2 }}
        >
          {h.text}
        </A>
      )}
    </For>
  );
}

/** The contents as a popover under the title, where the page has no room for the rail. */
function OnThisPage(props: { page: Page }) {
  const [current, setCurrent] = createSignal('');
  let button!: HTMLButtonElement;
  let panel!: HTMLDivElement;
  const edit = () => (
    <a class="docs-edit" href={props.page.source} target="_blank" rel="noreferrer">
      Edit this page on GitHub
    </a>
  );
  return (
    <div class="doc-onpage">
      <Show when={props.page.headings.length > 1} fallback={edit()}>
        <button ref={button} type="button" popovertarget="doc-onpage-panel">
          On this page
          <svg viewBox="0 0 10 6" aria-hidden="true">
            <path d="M1 1l4 4 4-4" />
          </svg>
        </button>
        <div
          ref={panel}
          id="doc-onpage-panel"
          class="doc-onpage-panel"
          popover="auto"
          onBeforeToggle={e => {
            if (e.newState !== 'open') return;
            setCurrent(sectionInView(props.page));
            const at = button.getBoundingClientRect();
            panel.style.top = `${at.bottom + window.scrollY + 4}px`;
            panel.style.left = `${at.left + window.scrollX}px`;
          }}
          onClick={e => (e.target as Element).closest('a') && panel.hidePopover()}
        >
          <SectionLinks page={props.page} current={current()} />
          {edit()}
        </div>
      </Show>
    </div>
  );
}

/** "On this page", with the section in view marked. */
function Contents(props: { page: Page }) {
  const [current, setCurrent] = createSignal('');
  onMount(() => {
    const spy = () => setCurrent(sectionInView(props.page));
    window.addEventListener('scroll', spy, { passive: true });
    createEffect(
      on(
        () => props.page,
        () => requestAnimationFrame(spy),
      ),
    );
    onCleanup(() => window.removeEventListener('scroll', spy));
  });
  return (
    <aside class="docs-toc" aria-label="On this page">
      {/* The home's sections sit side by side, so a list of them would only repeat them. */}
      <Show when={props.page.headings.length > 1 && props.page.slug !== HOME}>
        <h2>On this page</h2>
        <SectionLinks page={props.page} current={current()} />
      </Show>
      <a class="docs-edit" href={props.page.source} target="_blank" rel="noreferrer">
        Edit this page on GitHub
      </a>
    </aside>
  );
}

function Pager(props: { prev?: Page; next?: Page }) {
  return (
    <nav class="doc-pager" aria-label="Previous and next">
      <Show when={props.prev} fallback={<span />}>
        {p => (
          <A href={docsPath(p().slug)}>
            <small>← Previous</small>
            {p().title}
          </A>
        )}
      </Show>
      <Show when={props.next} fallback={<span />}>
        {p => (
          <A href={docsPath(p().slug)} class="is-next">
            <small>Next →</small>
            {p().title}
          </A>
        )}
      </Show>
    </nav>
  );
}
