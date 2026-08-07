import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        terms: resolve(import.meta.dirname, 'terms.html')
      }
    }
  },
  server: {
    // App dev server proxies to `wrangler dev` for the API
    proxy: {
      '/api': 'http://localhost:8787'
    }
  }
});
