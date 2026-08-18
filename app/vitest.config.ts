import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // React plugin so component render tests (e.g. the markdown test) can import
  // .tsx and transpile JSX. tsconfig sets jsx:"preserve" for Next, which esbuild
  // alone won't transform; the plugin uses the automatic runtime instead.
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
