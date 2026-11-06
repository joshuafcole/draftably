# @draftably/markdown

## 0.2.0

### Minor Changes

- 98664eb: Add shared file assets and one-call Markdown rendering
- d8f89ef: Add an async markdown-it adapter and an opt-in viewer client entry. Static
  Markdown continues to render an accessible SVG image without client code.
- 3f04900: Add the shared Markdown core and async remark adapter for static SVG diagram assets.
- 4ad188c: New `mermaid: 'convert'` option for the remark and markdown-it adapters. A `mermaid` fence that holds a flowchart or sequence becomes the same static SVG image as a `draft` fence, with no Mermaid in the browser. Pie, gantt and every other Mermaid family stay code blocks for the site's Mermaid setup.

### Patch Changes

- fe01bb5: The guides for every package moved to draftably.dev/docs, and each package README now links there. The Emphasis states page draws each state live.
- Updated dependencies [3b77f78]
- Updated dependencies [fe01bb5]
- Updated dependencies [ba5f518]
- Updated dependencies [b05bb95]
- Updated dependencies [a0786b0]
- Updated dependencies [fdb759b]
  - @draftably/runtime@0.2.0
