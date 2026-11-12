# Events and status

Each element tells the page what happens through events and a `status` attribute. This page lists
every event, which element sends it, and its name in each framework.

## Events

Each element dispatches its events as bubbling `draft-<name>` `CustomEvent`s, with the event's
data in `detail`. Listeners on the element survive a new viewer or editor. The **Sent by** column
says which element sends each one.

| Event                | Sent by | `detail`                                                                                                                                                                                                                                             |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft-update`       | both    | The result of each update, from the first source on. The viewer's is an `UpdateResult`. The editor's is an `EditorUpdate`: a commit has no `value` or `diagnostics`, and a source that does not parse is an `error` with a `DRAFT_PARSE` diagnostic. |
| `draft-anchors`      | both    | `{ anchors }` after each drawing and each change in slot content: `{ slot, id, kind, el }` per target; `[]` before the element goes.                                                                                                                 |
| `draft-render`       | diagram | `{ revision, value, geometry }` after each drawing. The editor draws no standalone SVG; read `editor.geometry()` instead.                                                                                                                            |
| `draft-diagnostics`  | both    | `{ revision, diagnostics, stale }`. The editor's holds a parse error first, then slot warnings.                                                                                                                                                      |
| `draft-camera`       | both    | `{ camera, reason }` after a pan, zoom or fit.                                                                                                                                                                                                       |
| `draft-itemactivate` | diagram | `{ id, kind, input, revision }` when the user picks an item. In the editor a press selects the item: listen for `draft-select`.                                                                                                                      |
| `draft-link`         | both    | `{ itemId, href, target }` when the user opens a link. Call `preventDefault()` to open it yourself. In the editor the link mark opens it, and `target` is `_blank`.                                                                                  |
| `draft-contextmenu`  | both    | `{ id, kind, clientX, clientY }`; `id` is null on the background. Call `preventDefault()` to stop the browser's menu and show your own.                                                                                                              |
| `draft-select`       | editor  | `{ ids, reason }`: the selection changed, by the user (`user`) or through `select()` (`api`).                                                                                                                                                        |
| `draft-change`       | editor  | `{ source }` after each kept edit, undo and redo.                                                                                                                                                                                                    |

```ts
diagram.addEventListener('draft-itemactivate', event => console.log(event.detail.id));
```

The `@draftably/runtime` types add these events to `HTMLElementEventMap`, so `event.detail` needs
no cast. `HOST_EVENTS` from `@draftably/runtime/host` lists every event name. A framework
component's `onLink` or `onContextmenu` prop receives the `detail` with the same
`preventDefault()`, so you can cancel either one without a listener on the element.

### Names in each framework

An event prop is `on` and the event's lowercase name. Vue uses the name itself.

| Event          | Element              | React and Solid  | Vue             | Svelte           |
| -------------- | -------------------- | ---------------- | --------------- | ---------------- |
| `update`       | `draft-update`       | `onUpdate`       | `@update`       | `onupdate`       |
| `itemactivate` | `draft-itemactivate` | `onItemactivate` | `@itemactivate` | `onitemactivate` |
| `contextmenu`  | `draft-contextmenu`  | `onContextmenu`  | `@contextmenu`  | `oncontextmenu`  |
| `change`       | `draft-change`       | `onChange`       | `@change`       | `onchange`       |

The other events follow the same pattern: `render`, `diagnostics`, `camera`, `link`, `anchors`
and `select`. TypeScript suggests the right name when you type `onItemActivate`.

### Cancel an event

`link` and `contextmenu` are cancelable. On the element, call `event.preventDefault()`. A framework
prop receives the `detail` with the same `preventDefault()`:

```svelte
<DraftDiagram
  {source}
  oncontextmenu={event => {
    event.preventDefault(); // no browser menu
    openMenu(event.id, event.clientX, event.clientY);
  }}
/>
```

`id` is `null` for a press on the background. Without a cancel, Draftably opens the link, and the
browser shows its own menu.

## The status attribute

The element reflects its state in a `status` attribute. Style each state with ordinary CSS, such as
`draft-diagram[status='loading'] { opacity: 0.6; }`.

| `status`     | When                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `loading`    | From the mount until the first update ends.                                                            |
| `ready`      | After the first drawing. It stays `ready` when a later update fails: the last drawing stays on screen. |
| `error`      | The first update failed, or the viewer could not mount. The fallback stays and the element shows why.  |
| no attribute | `source` is empty.                                                                                     |

A later failed update keeps `ready`, so watch `draft-update` or `draft-diagnostics` for it, not the
attribute.

If two copies of the runtime load on one page, the second copy warns once in the console and the
first copy's element stays in use.

## Change the source

Set the property or the attribute. Both update the drawing:

```ts
const diagram = document.querySelector('draft-diagram')!;
diagram.source = 'node api "Updated API"';
void diagram.updateComplete.then(result => {
  if (result?.status === 'error') console.error(result.error.diagnostics);
});
```

| Attribute | Effect                                                                    |
| --------- | ------------------------------------------------------------------------- |
| `source`  | The `.draft` text. A change redraws the diagram and keeps the camera.     |
| `label`   | The accessible name.                                                      |
| `state`   | A declared [emphasis state](#emphasis-states) to show.                    |
| `outline` | `visible` keeps the item list under the drawing. Default: shown on focus. |

Change them with `setAttribute`, such as `diagram.setAttribute('label', 'Checkout flow')`.

An invalid update keeps the last good drawing and shows its diagnostic. `updateComplete` settles
for the current update, including cancellation or removal. The bubbling `draft-update` event carries
an `UpdateResult` in `event.detail`: `committed`, `error`, `superseded`, `destroyed` or `aborted`.

## Diagnostics

`diagnostics` lists the source's errors and warnings, each with a `code`, a `severity`, a
`message` and, for source problems, a `location` with the line. A failed update keeps the last
drawing and shows its message under it, with the drawing marked stale.

| Code                     | Meaning                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `DRAFT_COMPILE`          | The source has an error or a warning. The message names the line.                   |
| `DRAFT_PARSE`            | The editor could not read the source. It keeps the text and shows it.               |
| `DRAFT_LIMIT`            | The source is past a size limit, such as too many objects.                          |
| `DRAFT_STATE_UNKNOWN`    | `state` names an emphasis state the source does not declare.                        |
| `DRAFT_TEXT_INVALID`     | The text holds characters that SVG cannot carry.                                    |
| `DRAFT_LINK_BLOCKED`     | The link policy blocked a link's destination.                                       |
| `DRAFT_SLOT_UNKNOWN`     | A slot names an item the drawing lacks, or its prefix is not `body:` or `overlay:`. |
| `DRAFT_SLOT_OVERFLOW`    | Slot content is larger than its node. Give the node room in the source.             |
| `DRAFT_FONT_UNAVAILABLE` | The fonts did not load. Check `font-src` in your CSP.                               |
| `DRAFT_VIEWER_WORKER`    | The render worker failed or timed out. See [Troubleshooting](#troubleshooting).     |
| `DRAFT_ELEMENT_MOUNT`    | The element could not mount a viewer or an editor.                                  |
| `DRAFT_ABORTED`          | The update was cancelled.                                                           |
| `DRAFT_INTERNAL`         | A fault in Draftably. Please report it with the source.                             |

When `<draft-editor>` cannot load, it sets `status="error"` and puts the reason in its `data-error`
attribute; `host.css` shows that text in the element.
