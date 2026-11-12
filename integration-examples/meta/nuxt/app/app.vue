<script setup lang="ts">
import { renderSvg } from '@draftably/vue';
import { Proof } from './proof/Proof.ts';
import { proofSource } from './proof/proof.js';

// The server draws the fallback SVG with this request's nonce; the payload carries both.
const event = useRequestEvent();
const { data } = await useAsyncData('proof', async () => {
  const nonce = event?.context.nonce as string;
  const result = await renderSvg(proofSource, {
    target: 'inline',
    idPrefix: 'proof',
    styleNonce: nonce,
  });
  return { svg: result.ok ? result.value.svg : undefined, nonce };
});
</script>

<template>
  <Proof :svg="data?.svg" :nonce="data?.nonce" />
</template>
