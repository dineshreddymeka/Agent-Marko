import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../packages/shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/agui': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  worker: {
    format: 'es',
  },
})
