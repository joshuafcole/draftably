import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { Logo } from '../Logo';
import { SiteNav } from '../SiteNav';
import { savedTitle } from '../../src/lib/saved-diagram';
import { EXAMPLES, findExample, type ExampleInfo } from '../../src/model/examples';
import { appUrl, paperOf } from '../draw';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { demoEditorUrl, LiveEditor } from '../live/LiveEditor';
import { deliver, ImportCancelled, readDiagramFile, unreadableFile } from '../reopen';
import { CopyCommand } from './CopyCommand';
import { Mermaid } from './Mermaid';
import { Points } from './Points';
import { drawSvg, enqueue, whenSeen } from './render';

const GITHUB = 'https://github.com/byronwall/draftably';
const NPM = 'https://www.npmjs.com/package/draftably';

const HERO_EXAMPLES = [
  'checkout',
  'login-sequence',
  'order-lifecycle',
  'support-triage',
  'billing-schema',
];
/** The box each hero example labels "Drag me". */
const HERO_HINTS: Record<string, string> = {
  checkout: 'db',
  'login-sequence': 'auth',
  'order-lifecycle': 'cancelled',
  'support-triage': 'link',
  'billing-schema': 'invoices',
};
/** None of these repeat a hero tab, so every example on the page is a new one. */
const CARD_EXAMPLES = [
  'multi-region-failover',
  'incident-response',
  'data-lakehouse',
  'observability-stack',
  'rag-assistant',
  'order-saga',
  'tcp-header',
  'kubernetes-cluster',
];

const COMMANDS: [string, string][] = [
  ['draftably check plan.draft', 'Reports errors by line. Exits 1, so CI can fail on them.'],
  ['draftably compare old.draft new.draft', 'Marks what changed between two versions.'],
  ['draftably vary plan.draft', 'Ranks layout variants on one contact sheet.'],
];

const TITLE = 'draftably: diagrams from plain text';

/** The demo's URL once it is edited (it then carries a `#s=` hash); the blank Editor before that. */
const heroEditorUrl = () => (demoEditorUrl().includes('#') ? demoEditorUrl() : appUrl());

export function Landing() {
  // Back from the editor, the button names the diagram it reopens. An edited demo takes priority.
  const resume = () => (demoEditorUrl().includes('#') ? '' : savedTitle());
  // Arriving from another page keeps that page's title; name this one.
  onMount(() => (document.title = TITLE));
  // The router changes the hash without scrolling, so a link to a section of this page (or to
  // it from another page) scrolls there once the section exists.
  const location = useLocation();
  createEffect(
    on(
      () => location.hash,
      hash => {
        if (!hash) return;
        setTimeout(() =>
          document
            .getElementById(decodeURIComponent(hash.slice(1)))
            ?.scrollIntoView({ behavior: 'instant' }),
        );
      },
    ),
  );
  return (
    <div class="page">
      <SkipLink />
      <Nav />
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
        <section class="hero">
          <h1>Diagrams used to be a drag.</h1>
          <div class="hero-head">
            <div>
              <p class="hero-kicker">Now you write them. Drag only if you want to.</p>
              <p class="hero-sub">
                Architecture, flows, sequences, state machines and schemas, laid out from text. Move
                a box and the file gets readable lines. Use it in the browser, the terminal, your
                app or your coding agent.
              </p>
            </div>
            <div class="hero-actions">
              <a
                class="button primary hero-open"
                href={heroEditorUrl()}
                rel="external"
                title={resume() || undefined}
              >
                <Show when={resume()} fallback="Open the editor">
                  <span>Continue “{resume()}”</span>
                </Show>
              </a>
              <CopyCommand text="npx draftably open" class="button" />
            </div>
          </div>
          <LiveEditor examples={HERO_EXAMPLES} hints={HERO_HINTS} />
          <ReopenLine />
        </section>
        <Install />
        <Mermaid />
        <Points />
        <Examples />
      </main>
      <footer class="footer" style={{ 'flex-wrap': 'wrap' }}>
        <span class="wordmark">
          <Logo size={18} />
          draftably
        </span>
        <span class="footer-links">
          <A href="/play">Playground</A>
          <a href={appUrl()} rel="external">
            Editor
          </a>
          <A href="/docs">Docs</A>
          <a href={NPM}>npm</a>
          <a href={GITHUB}>GitHub</a>
        </span>
        <p style={{ width: '100%', margin: 0, color: 'var(--muted)', 'font-size': '13px' }}>
          Playground: write the source and see it draw. Editor: build on a canvas, tidy the layout
          and save a file.
        </p>
      </footer>
    </div>
  );
}

/** Hidden until it has focus: the first Tab stop on the page. */
function SkipLink() {
  const [shown, setShown] = createSignal(false);
  return (
    <a
      href="#main"
      class={shown() ? 'button primary' : 'sr-only'}
      style={shown() ? { position: 'fixed', top: '8px', left: '8px', 'z-index': 10 } : undefined}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
      onClick={e => {
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}
    >
      Skip to content
    </a>
  );
}

/** A link inside muted text: accent color and no underline, unlike a bare link there. */
function DocLink(props: { href: string; children: string }) {
  return (
    <A
      href={props.href}
      style={{ color: 'var(--accent)', 'text-decoration': 'none', 'white-space': 'nowrap' }}
    >
      {props.children}
    </A>
  );
}

function Nav() {
  return (
    <header class="nav">
      <a class="wordmark" href={import.meta.env.BASE_URL}>
        <Logo />
        draftably
      </a>
      <SiteNav current="home" class="nav-links" />
    </header>
  );
}

function Examples() {
  const cards = CARD_EXAMPLES.map(findExample).filter((e): e is ExampleInfo => !!e);
  return (
    <section class="examples" id="examples">
      <div class="section-head">
        <h2>More examples</h2>
        <a href={appUrl()} rel="external">
          Open all {EXAMPLES.length} in the editor
        </a>
      </div>
      <div class="cards">
        <For each={cards}>{ex => <ExampleCard example={ex} />}</For>
      </div>
    </section>
  );
}

function ExampleCard(props: { example: ExampleInfo }) {
  const [src, setSrc] = createSignal('');
  const [paper, setPaper] = createSignal<string>();
  let card!: HTMLAnchorElement;
  onMount(() => {
    const stop = whenSeen(card, () =>
      enqueue(async () => {
        const svg = await drawSvg(props.example.source);
        if (!svg) return;
        setPaper(paperOf(svg));
        setSrc(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
      }),
    );
    onCleanup(() => {
      stop();
      if (src()) URL.revokeObjectURL(src());
    });
  });
  const ex = () => props.example;
  return (
    <a class="card" href={appUrl(ex().id)} rel="external" ref={card}>
      <div class="card-thumb" style={{ background: paper() }}>
        <Show when={src()}>
          <img src={src()} alt="" onLoad={e => e.currentTarget.classList.add('is-loaded')} />
        </Show>
      </div>
      <h3>{ex().title}</h3>
      <p>{ex().summary}</p>
    </a>
  );
}

function Install() {
  return (
    <section class="install" id="install">
      <div class="section-head">
        <h2>One file, four ways to use it</h2>
      </div>
      <div class="install-cols">
        <div>
          <h3>Static: ship a picture</h3>
          <p>
            An SVG or PNG for READMEs, docs and pull requests. Nothing in it moves. The source rides
            inside the image, so drop it back here to edit it.
          </p>
          <CopyCommand text="npx draftably inspect plan.draft --svg > plan.svg" />
        </div>
        <div>
          <h3>Live: keep a diagram</h3>
          <p>
            The editor on your own file. Drag a box and the move lands in the file as plain,
            readable lines. Edit the text and the drawing follows. Git sees every change.
          </p>
          <CopyCommand text="npx draftably open plan.draft" />
        </div>
        <div>
          <h3>Agent: let it draw for you</h3>
          <p>
            A bundled skill teaches an agent the language, so it writes, checks and renders{' '}
            <code>.draft</code> files on its own. Add <code>--global</code> for every project.{' '}
            <DocLink href="/docs/agent-skill">Read the guide</DocLink>.
          </p>
          <CopyCommand text="npx draftably skill install" />
        </div>
        <div>
          <h3>Embed: put it in your app</h3>
          <p>
            A component for React, Solid, Vue and Svelte, an HTML element, or SVG from a build step.
            Add the editor and your users can drag too.{' '}
            <DocLink href="/docs/embed">Pick a route</DocLink>.
          </p>
          <CopyCommand text="pnpm add @draftably/react" />
        </div>
      </div>
      <dl class="commands">
        <For each={COMMANDS}>
          {([cmd, what]) => (
            <>
              <dt>
                <code>{cmd}</code>
              </dt>
              <dd>{what}</dd>
            </>
          )}
        </For>
      </dl>
      <p class="install-note">
        Needs Node 22.21 or later. Run <code>npm i -g draftably</code> to drop the <code>npx</code>.{' '}
        <DocLink href="/docs/cli">See every command</DocLink>.
      </p>
    </section>
  );
}

/** Someone with an exported diagram goes straight back to editing it. */
function ReopenLine() {
  const navigate = useNavigate();
  const [error, setError] = createSignal('');
  const choose = async (file: File) => {
    setError('');
    try {
      const source = await readDiagramFile(file);
      if (source == null) throw Error(unreadableFile(file.name));
      deliver(source);
      navigate('/play');
    } catch (error) {
      if (!(error instanceof ImportCancelled))
        setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <p class="hero-reopen" classList={{ 'is-error': !!error() }}>
      <span role="alert">{error()}</span>{' '}
      <Show when={!error()}>Have a diagram file? Drop or paste it anywhere, or </Show>
      <label class="hero-reopen-pick">
        {error() ? 'Choose another file' : 'choose a file'}
        <input
          type="file"
          accept=".draft,.png,.svg,.dot,.gv,.mmd,.mermaid,.d2,image/png,image/svg+xml"
          class="sr-only"
          onChange={e => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void choose(file);
          }}
        />
      </label>
      <Show when={!error()}>, to keep editing. Runs in your browser. Nothing is uploaded.</Show>
    </p>
  );
}
