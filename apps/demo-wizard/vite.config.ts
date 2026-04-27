import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      // Point @prepatu/sdk directly to the local TypeScript source — no build step required
      '@prepatu/sdk': path.resolve(__dirname, '../../packages/sdk/src/index.ts'),
    },
  },
});
