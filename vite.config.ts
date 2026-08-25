import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = 'http://127.0.0.1:8465'

export default defineConfig({
  // Browser builds never need server secrets and must not load local env files.
  envDir: false,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 8464,
    strictPort: true,
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
      '^/s/': apiTarget,
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
})
