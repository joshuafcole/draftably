# Performance

What a diagram costs a page, and how to keep that cost low when a page shows many diagrams or
large ones.

## What a page loads

- **The viewer.** A page that only shows diagrams runs about 16 KB (gzip) of JavaScript on its main
  thread. The compiler, the layout and the router run in a worker, which loads on the first
  drawing.
- **The editor.** The editor is a separate package of about 330 KB (gzip). The framework
  components import it only after they mount in the browser, so server rendering and pages that
  only show diagrams never download it. `vite build` warns that the editor's chunk is over 500 KB;
  that is expected.
- **Fonts.** The viewer embeds the fonts a drawing uses as `data:` URLs, once per page. With
  `render: { fonts: 'host' }` they load as files from `@draftably/runtime/fonts.css` instead.

## Many diagrams on a page

All diagrams on a page share at most four render workers (one fewer than the device's cores), one
stylesheet and one copy of each font. A worker stops after 30 seconds with no work, and the next
update starts a new one. Twenty diagrams on one page use four workers, one stylesheet and no long
task over 200 ms.

An element mounts when it connects to the page. To draw a long page's diagrams only as they scroll
into view, add each element when it comes near the viewport:

```ts
const observer = new IntersectionObserver(
  entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const diagram = document.createElement('draft-diagram');
      diagram.source = entry.target.getAttribute('data-source')!;
      entry.target.replaceWith(diagram);
    }
  },
  { rootMargin: '400px' },
);
document.querySelectorAll('.diagram-slot').forEach(el => observer.observe(el));
```

Give each placeholder the diagram's height, so the page does not shift when it is replaced.

## Updates

An update compiles, lays out and routes the whole source again, in the worker, then swaps the
drawing in one step. A diagram of 28 boxes updates in about 140 ms. The page stays responsive
while the worker runs. A newer update makes an older one `superseded`, so typing never queues work.

`geometry()` returns the same object for one revision, so reading it in a render loop costs
nothing. Camera moves set one transform per animation frame and read no layout.

## Main-thread mode

`execution: { mode: 'main' }` compiles on the page's thread. The compiler then loads into the page,
and a large diagram blocks input while it draws. Use it for small diagrams, for a link resolver
function (a worker cannot receive a function), or when the page cannot load a worker from its own
origin.

## Measure your page

`updateComplete` resolves when the drawing is on screen, so it times an update:

```ts
const start = performance.now();
diagram.source = next;
await diagram.updateComplete;
console.log(`drawn in ${Math.round(performance.now() - start)} ms`);
```
