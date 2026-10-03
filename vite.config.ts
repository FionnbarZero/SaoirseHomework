import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4179',
    },
  },
  preview: { port: 4181, strictPort: true },
})
