import { svelte } from '@sveltejs/vite-plugin-svelte';

export default {
  plugins: [svelte()],
  optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] },
  build: { rollupOptions: { input: ['index.html', 'proof.html'] } },
};
