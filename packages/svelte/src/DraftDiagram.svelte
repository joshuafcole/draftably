<!-- `<DraftDiagram>` for Svelte 5: the `<draft-diagram>` element with Svelte props and event props. -->
<script>
  import '@draftably/runtime/element';
  import { elementAttributes, listenHostEvents } from './events.js';

  /** @type {import('./index').DraftDiagramProps} */
  let {
    source,
    state: emphasis = null,
    label,
    outline,
    svg,
    options = {},
    element = $bindable(),
    class: className,
    style,
    children,
    ...rest
  } = $props();

  // Spread before the named attributes, so they win. The element registers on import, so the
  // spread sets `options` as a property. The server skips `options`: it would write the object as
  // the text "[object Object]".
  const attributes = $derived(elementAttributes(rest));
  $effect(() => listenHostEvents(element, rest));
</script>

<draft-diagram bind:this={element} {...attributes} {source} state={emphasis ?? undefined} {label} {outline} {...(typeof window === 'undefined' ? {} : { options })} class={className} {style}>
  {#if svg}<div>{@html svg}</div>{/if}
  {@render children?.()}
</draft-diagram>
