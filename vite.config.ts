import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    if (!env.VITE_GEMINI_API_KEY || env.VITE_GEMINI_API_KEY === 'PLACEHOLDER_API_KEY') {
      console.warn('⚠️  WARNING: VITE_GEMINI_API_KEY is not set or is a placeholder. Please set a valid API key in .env.local');
    }
    
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      },
      preview: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      // Vite exposes env via `import.meta.env` for keys prefixed with VITE_.
      // No need to define `process.env` mappings.
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        outDir: 'dist',
        sourcemap: false,
        commonjsOptions: {
          transformMixedEsModules: true
        }
      }
    };
});
