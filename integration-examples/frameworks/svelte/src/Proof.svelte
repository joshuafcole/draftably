<!-- The host proof page in Svelte. `../../proof.js` describes the page; SvelteKit reuses this file. -->
<script>
  import { onMount, setContext } from 'svelte';
  import { DraftDiagram } from '@draftably/svelte';
  import { DraftEditor } from '@draftably/svelte/editor';
  import Card from './Card.svelte';
  import { PROOF_OWNER, cancelLink, cancelMenu, cycleSource, editorSources, exposeProof, proofBroken, proofHooks, proofSource, proofUpdated, viewerOptions } from '../../proof.js';

  /** @type {{ svg?: string; nonce?: string }} */
  let { svg, nonce } = $props();
  setContext('owner', PROOF_OWNER);
  let source = $state(proofSource);
  let cycle = $state(false);
  const options = viewerOptions(nonce);
  onMount(() =>
    exposeProof({
      update: () => (source = proofUpdated),
      fail: () => (source = proofBroken),
      toggle: () => (cycle = !cycle),
    }),
  );
</script>

<section id="p-viewer">
  <DraftDiagram {source} {svg} label="Proof" {options} data-proof="viewer" oncontextmenu={cancelMenu} onlink={cancelLink}><Card /></DraftDiagram>
</section>
<section id="p-editors">
  {#each editorSources as s, i (i)}
    <DraftEditor source={s} class="proof-editor" data-proof="editor" onchange={({ source: next }) => proofHooks().changes[i].push(next)} />
  {/each}
</section>
<section id="p-cycle">
  {#if cycle}
    <DraftDiagram source={cycleSource} {options} />
    <DraftEditor source={cycleSource} class="proof-editor" />
  {/if}
</section>
