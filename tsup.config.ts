import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'backup-database': 'scripts/backup-database.ts',
    index: 'src/server/index.ts',
    'restore-database': 'scripts/restore-database.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist/server',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
})
