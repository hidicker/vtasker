
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    return {
      // This ensures the app works correctly when deployed to nbparagliding.nz/vtasker/ but works on / in the AI Studio preview
      base: mode === 'production' ? '/vtasker/' : '/', 
      
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      build: {
        rollupOptions: {
          output: {
            // Split the big third-party libs out of the app chunk: they change far
            // less often than our code, so browsers keep them cached across deploys.
            // react/react-dom deliberately aren't listed: they're resolved via the
            // importmap in index.html, so naming them here just emits an empty chunk.
            manualChunks: {
              leaflet: ['leaflet', 'react-leaflet'],
              supabase: ['@supabase/supabase-js'],
            },
          },
        },
      },
      resolve: {
        alias: {
          // Fix: Replace __dirname with path.resolve('.') as __dirname is not available in some ESM/TS configurations
          '@': path.resolve('.'),
        }
      }
    };
});
