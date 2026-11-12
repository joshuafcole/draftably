# Diagram element example

This example needs no viewer lifecycle code or viewer CSS import. It uses
`<draft-diagram>` for source updates, cleanup, and a static image fallback.

Install the runtime, then run the example:

```sh
pnpm add @draftably/runtime
pnpm install
pnpm dev
```

Open the printed URL. **Update source** changes Orders to Archive.
**Try invalid source** keeps the last drawing and shows the source error.
**Remove diagram** removes the element and its worker. **Add diagram** mounts it again.

`pnpm build` uses the default Vite target. The Vite configuration excludes the
runtime from dependency optimization so its worker resolves during development.
`fallback.ts` generates the image once before starting or building the page.

The source files are small enough to copy into an existing Vite app. The
[plain HTML guide](https://draftably.dev/docs/plain-html) shows the minimum integration.
