import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist/server',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
})
