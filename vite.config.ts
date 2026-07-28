/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

/*
 * The Cloudflare plugin builds the Worker and writes the wrangler manifest the deploy
 * step uploads, but it installs a dev-server hook that Vitest cannot satisfy — under
 * test there is no server for it to configure, and it fails before a single test runs.
 * Tests exercise the library, never the Worker, so it is left out there.
 */
const underTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

export default defineConfig({
  plugins: [react(), ...(underTest ? [] : [cloudflare()])],
  server: {
    // Honour a port handed down by the environment, and fail rather than silently
    // sliding to the next free one — a caller that was told 5180 cannot find 5181.
    port: Number(process.env.PORT) || 5173,
    strictPort: !!process.env.PORT,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
