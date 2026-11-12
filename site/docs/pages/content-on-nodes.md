# Content on nodes

Put your own markup on a node: a card with live numbers, a button, a field, a badge. Your framework
keeps rendering it, your page CSS styles it, and the diagram places it.

## Put your content on a node

Put your own markup on a node with an ordinary child of the element, marked `data-draft-slot`.
The element places it; your framework keeps rendering it, and your page CSS styles it.

```html
<draft-diagram source="…">
  <div data-draft-slot="body:api" class="card">
    <strong>API</strong> 12 ms p95
    <button data-draft-input>Open</button>
  </div>
  <span data-draft-slot="overlay:db" class="badge">3</span>
</draft-diagram>
```

- **`body:<id>`** fills a node, in diagram units. It scales and clips with the node and
  takes the place of the drawn title. The title stays the node's accessible name. Nodes only.
- **`overlay:<id>`** covers a node, group or edge on screen, at screen size, with
  `overflow: visible`. Position a badge or a menu in or around it with your own CSS.

Rules:

- **Room.** Layout never measures your content. Give the node room in the source, for example
  `size api width=220 height=auto min-height=110`. Content larger than its node adds a
  `DRAFT_SLOT_OVERFLOW` warning to `diagnostics`.
- **Input.** Slot content takes no pointer input, so the pointer reaches the node under it.
  Mark an element `data-draft-input`, at any depth, to give it its own pointer and keys: a
  button, a field or a menu. [`host.css`](#import-hostcss-once) gives marked content the pointer. Shortcuts never fire there, and Escape returns focus to the drawing.
  The wheel over marked content scrolls your content; over other slot content it zooms.
- **Updates.** A target keeps its place in the DOM while its item exists, across source updates and
  camera changes, so focus and a caret survive an update. When an item with focused content goes
  away, focus returns to the drawing. Focus that enters a body brings its node into view.
- **Unknown IDs.** A slot for an ID the drawing does not have shows nothing and adds a
  `DRAFT_SLOT_UNKNOWN` warning. `compare` and `states` drawings repeat items, so slots are off
  there, with the same warning.
- **Zoomed out.** Below a zoom of 0.4, bodies hide and titles show again. Set `detail: 'full'` in
  `options` to keep bodies at every zoom. Slot content inherits `--draft-zoom`, the current zoom,
  for your own rules. The layer's `data-draft-detail` attribute is inside the shadow root, so page
  CSS cannot read it.

  ```css
  /* Keep a body's small print readable on screen as the drawing zooms out. */
  .card small {
    font-size: calc(11px / max(var(--draft-zoom, 1), 0.5));
  }
  ```

- **Static output.** Exports, the CLI and `renderSvg` never contain your content. A server-rendered
  fallback draws titles.

The element never changes your elements. It assigns each marked child to its target in its shadow
root, so your framework stays the only owner of that DOM. The `anchors` event lists the targets
after each change.

Without the element, `mountViewer` gives the same layer: call `viewer.anchor(['body:api'])`, then
put content in each target the `anchors` event names. `viewer.css` lets content marked
`data-draft-input` in a target take the pointer, so you need no `host.css` rule there.

## In a framework

Pass the marked elements as children (the default slot in Vue). Your framework renders and updates
them as usual. Give each body room in the source: `size api width=220 height=auto min-height=110`.

React:

```tsx
<DraftDiagram source={source}>
  {services.map(s => (
    <div key={s.id} data-draft-slot={`body:${s.id}`} className="card">
      {s.name}{' '}
      <button data-draft-input="" onClick={() => open(s.id)}>
        Open
      </button>
    </div>
  ))}
  <span data-draft-slot="overlay:db" className="badge">
    {alerts}
  </span>
</DraftDiagram>
```

Solid (key the list by ID, so a changed label keeps its element and its focus):

```tsx
<DraftDiagram source={source()}>
  <For each={services().map(s => s.id)}>
    {id => (
      <div data-draft-slot={`body:${id}`} class="card">
        {nameOf(id)}{' '}
        <button data-draft-input onClick={() => open(id)}>
          Open
        </button>
      </div>
    )}
  </For>
</DraftDiagram>
```

Vue:

```vue
<DraftDiagram :source="source">
  <div v-for="s in services" :key="s.id" :data-draft-slot="`body:${s.id}`" class="card">
    {{ s.name }} <button data-draft-input @click="open(s.id)">Open</button>
  </div>
</DraftDiagram>
```

Svelte:

```svelte
<DraftDiagram {source}>
  {#each services as s (s.id)}
    <div data-draft-slot={`body:${s.id}`} class="card">
      {s.name} <button data-draft-input onclick={() => open(s.id)}>Open</button>
    </div>
  {/each}
</DraftDiagram>
```

`DraftEditor` takes the same children. The `anchors` event lists the targets, and `diagnostics`
reports a slot for an unknown ID or content larger than its node.

## In the editor

`<draft-editor>` takes the same children. A node with a body keeps its ports, resize handles and
selection ring above the body, so users still connect, resize and select it. A press on body text
selects the node and drags it, as a press on its title does. Keys typed in `data-draft-input` content never reach the editor's
shortcuts, so typing **N** in a field adds no node.
