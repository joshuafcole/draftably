// The Nuxt host proof. `app/proof/` holds a copy of the shared Vue proof page; `pnpm prove:meta
// --write` refreshes it.
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: false },
  telemetry: false,
  // Real stylesheets: inlined styles would need the per-request nonce.
  css: ['@draftably/runtime/host.css', '~/proof/proof.css'],
  features: { inlineStyles: false },
});
