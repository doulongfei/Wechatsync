import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/exports.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
