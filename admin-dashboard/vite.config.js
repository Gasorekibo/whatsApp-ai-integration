import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/ai/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ai/api':     { target: 'http://localhost:3000', changeOrigin: true, rewrite: p => p.replace(/^\/ai/, '') },
      '/ai/webhook': { target: 'http://localhost:3000', changeOrigin: true, rewrite: p => p.replace(/^\/ai/, '') },
      '/ai/auth':    { target: 'http://localhost:3000', changeOrigin: true, rewrite: p => p.replace(/^\/ai/, '') },
      '/api':        { target: 'http://localhost:3000', changeOrigin: true },
      '/webhook':    { target: 'http://localhost:3000', changeOrigin: true },
      '/auth':       { target: 'http://localhost:3000', changeOrigin: true },
    }
  }
})
