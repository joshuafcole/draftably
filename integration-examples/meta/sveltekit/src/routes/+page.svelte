<script lang="ts">
  import '@draftably/runtime/host.css';
  import '#lib/proof/proof.css';
  import Proof from '#lib/proof/Proof.svelte';

  let { data } = $props();
</script>

<Proof svg={data.svg} nonce={data.nonce} />
