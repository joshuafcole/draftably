<!-- Slot content that reads the host's context: the wrapper must keep it in the host's tree. -->
<script>
  import { getContext } from 'svelte';
  import { proofHooks } from '../../proof.js';

  const owner = getContext('owner') ?? 'no context';
  let clicks = $state(0);
</script>

<div data-draft-slot="body:api" class="proof-card">
  <span class="proof-owner">{owner}</span>
  <button
    data-draft-input
    class="proof-go"
    onclick={() => {
      proofHooks().clicks++;
      clicks++;
    }}>{`Go ${clicks}`}</button
  >
  <input data-draft-input class="proof-field" aria-label="Note" />
</div>
