import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, req) => {
            // Disable buffering for SSE
            if (req.url?.includes('/stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      }
    }
  }
})
