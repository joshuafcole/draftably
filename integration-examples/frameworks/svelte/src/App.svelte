<script>
  import { DraftDiagram } from '@draftably/svelte';
  import { DraftEditor } from '@draftably/svelte/editor';
  import { cards as firstCards, editorOptions, recordChange, recordClick, recordElement, recordEvent, slotCards, slotSource, sources, updated, viewerOptions } from '../../sources.js';

  let { svgs = [] } = $props();
  let list = $state(sources);
  let edits = $state(sources.slice(0, 2));
  let cards = $state(firstCards);
  globalThis.__slotUpdate = () => {
    list = [slotSource, ...list.slice(1)];
    cards = slotCards;
  };
  const record = result => (window.__updates ??= []).push(result.status);
  let first = $state();
  $effect(() => recordElement(first));
</script>

<main>
  <button id="update" onclick={() => (list = [updated, ...list.slice(1)])}>Update first</button>
  <button id="remove" onclick={() => (list = list.slice(0, 2))}>Remove last</button>
  {#each list as source, i (i)}
    {#if i === 0}
      <DraftDiagram {source} bind:element={first} label="Diagram 1" outline="visible" svg={svgs[i]} onupdate={record} oncamera={() => recordEvent('camera')}>
        <div data-draft-slot="overlay:api" class="badge">3</div>
        <div data-draft-slot="body:nope">ghost</div>
        {#each cards as c (c.id)}
          <div data-draft-slot={`body:${c.id}`} class="card" data-card={c.id}>
            <span>{c.label}</span>
            <button data-draft-input onclick={recordClick}>go</button>
            {#if c.id === 'api'}<input data-draft-input class="field" />{/if}
          </div>
        {/each}
      </DraftDiagram>
    {:else}
      <DraftDiagram {source} label={`Diagram ${i + 1}`} svg={svgs[i]} options={i === 1 ? viewerOptions() : undefined} onupdate={record} oncamera={() => recordEvent('camera')} />
    {/if}
  {/each}
  {#each edits as source, i (i)}
    <DraftEditor
      {source}
      style="height: 20rem"
      options={editorOptions()}
      onchange={({ source: next }) => {
        recordChange(i, next);
        edits = edits.map((s, j) => (j === i ? next : s));
      }}
    >
      {#if i === 0}
        <div data-draft-slot="body:api" class="card" data-card="editor-api">
          <span>API body</span>
          <input data-draft-input class="field" />
        </div>
      {/if}
    </DraftEditor>
  {/each}
</main>
