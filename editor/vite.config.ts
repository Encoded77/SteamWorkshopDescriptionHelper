import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No `server` block: src/dev.ts creates this in middleware mode, so host, port
// and HMR come from the parent http server.
export default defineConfig({
  plugins: [react()],
});
