import react from '@vitejs/plugin-react';

export default {
  plugins: [react()],
  optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] },
  build: { rollupOptions: { input: ['index.html', 'proof.html'] } },
};
