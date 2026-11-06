import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Teruskan semua request /api ke backend Express (server/) agar cookie sesi satu origin.
        proxy: {
          '/api': {
            target: env.API_PROXY_TARGET || 'http://localhost:4000',
            changeOrigin: false,
          },
        },
      },
      // Tidak ada API key di frontend: Asisten Virtual (Claude) dipanggil lewat backend /api/assistant.
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
