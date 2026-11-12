import solid from 'vite-plugin-solid';

export default {
  plugins: [solid({ ssr: true })],
  optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] },
  build: { rollupOptions: { input: ['index.html', 'proof.html'] } },
};
