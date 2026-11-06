import { A } from '@solidjs/router';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { paperOf } from '../draw';
import { Expand } from '../live/Expand';
import { CopyCommand } from './CopyCommand';
import { drawSvg, enqueue, whenSeen } from './render';

/** A Mermaid flowchart as a site has it today. */
const MERMAID = `flowchart LR
  web[Web app] -->|HTTPS| api[API]
  api --> auth[Auth]
  api --> cache{Cached?}
  cache -->|no| db[Orders DB]
  subgraph backend [Backend]
    api
    auth
    cache
    db
  end`;

/** What `draftably import` and the drop-in make of MERMAID, unchanged. */
const CONVERTED = `diagram "Checkout" version=1
group backend "Backend"
node web "Web app"
node api "API" in=backend
node auth "Auth" in=backend
node cache "Cached?" in=backend shape=diamond
node db "Orders DB" in=backend
edge edge_1 web -> api "HTTPS"
edge edge_2 api -> auth ""
edge edge_3 api -> cache ""
edge edge_4 cache -> db "no"
layout root flow direction=right
layout backend flow direction=right`;

const ROWS: [string, string, string][] = [
  ['Move a box', 'Layout runs again on every render', 'Drag it. The file keeps the move.'],
  [
    'Show what a pull request changed',
    'Style each node with classDef',
    'Start lines with +, - or ~',
  ],
  ['Focus on one path', 'Draw a second diagram', 'Add a state line'],
  ['Edit by hand', 'In text', 'In text or on the canvas'],
  ['Diagram kinds', 'Many, including pie and Gantt', 'Flows, sequences, lanes, grids'],
];

/** Mermaid users see their own source drawn, and the two ways to switch. */
export function Mermaid() {
  const [svg, setSvg] = createSignal('');
  let el!: HTMLElement;
  onMount(() =>
    onCleanup(
      whenSeen(el, () =>
        enqueue(async () => {
          const out = await drawSvg(CONVERTED);
          if (out) setSvg(out);
        }),
      ),
    ),
  );
  return (
    <section class="switch" id="mermaid" ref={el} aria-labelledby="switch-head">
      <div class="section-head">
        <h2 id="switch-head">Coming from Mermaid?</h2>
        <A href="/docs/from-mermaid">Switch from Mermaid</A>
      </div>
      <div class="switch-body">
        <div class="switch-text">
          <p class="switch-lead">
            Keep your Mermaid. The drop-in draws flowcharts and sequences with Draftably and hands
            every other chart to Mermaid, so nothing on your page goes blank.
          </p>
          <div class="switch-routes">
            <div>
              <h3>Swap the package</h3>
              <p>
                Your <code>import mermaid</code> now loads Draftably. A CDN page changes one URL.
              </p>
              <CopyCommand text="pnpm add mermaid@npm:@draftably/mermaid" />
            </div>
            <div>
              <h3>Convert your docs</h3>
              <p>
                Lists each <code>mermaid</code> fence and what it becomes. Add <code>--write</code>{' '}
                to change the files.
              </p>
              <CopyCommand text="npx draftably migrate docs/" />
            </div>
          </div>
          <table class="switch-table">
            <thead>
              <tr>
                <th scope="col">
                  <span class="sr-only">Task</span>
                </th>
                <th scope="col">Mermaid</th>
                <th scope="col">Draftably</th>
              </tr>
            </thead>
            <tbody>
              <For each={ROWS}>
                {([task, mermaid, draftably]) => (
                  <tr>
                    <th scope="row">{task}</th>
                    <td>{mermaid}</td>
                    <td>{draftably}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <figure class="switch-figure">
          <div class="switch-pane">
            <p class="switch-caption">Your Mermaid</p>
            <pre class="switch-source">{MERMAID}</pre>
          </div>
          <div class="switch-pane switch-pane-drawing" style={{ background: paperOf(svg()) }}>
            <p class="switch-caption">Drawn by Draftably</p>
            <Show when={svg()}>
              <Expand svg={svg()} />
            </Show>
            <div
              class="switch-drawing"
              classList={{ 'is-drawn': !!svg() }}
              role="img"
              aria-label="The same flowchart drawn by Draftably: Web app calls the API in a Backend group, which calls Auth and a Cached? check that falls through to the Orders DB."
              // The SVG comes from our own renderer, which escapes every label.
              // eslint-disable-next-line solid/no-innerhtml
              innerHTML={svg()}
            />
          </div>
        </figure>
      </div>
    </section>
  );
}
