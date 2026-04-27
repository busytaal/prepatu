import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 5174,
  },
  resolve: {
    alias: {
      '@prepatu/sdk': path.resolve(__dirname, '../../packages/sdk/src/index.ts'),
    },
  },
});
