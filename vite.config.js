import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/pitoviento/',
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        react: resolve(process.cwd(), 'react.html'),
        server: resolve(process.cwd(), 'server.html')
      }
    }
  }
});
