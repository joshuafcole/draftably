import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// SvelteKit 3 takes its options here. `inlineStyleThreshold` stays at its default 0, so CSS
// ships as stylesheet links and the strict CSP needs no style nonce for SvelteKit itself.
export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
