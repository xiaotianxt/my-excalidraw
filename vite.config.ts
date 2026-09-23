import { defineConfig } from 'vite';
import path from 'node:path';
import { cpSync } from 'node:fs';
import electron from 'vite-plugin-electron/simple';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Bundle the editor's fonts locally; drawing must work without a CDN.
cpSync('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'public/excalidraw-assets/fonts', { recursive: true });

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: id => /\/node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react-vendor' : undefined,
      },
    },
  },
  plugins: [{
    name: 'desktop-content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'",
      },
      injectTo: 'head-prepend',
    }],
  }, react(), tailwindcss(), electron({
    main: { entry: 'electron/main.ts' },
    preload: { input: path.join(import.meta.dirname, 'electron/preload.ts') },
  })],
});
