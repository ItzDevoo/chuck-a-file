import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    // Some Vite plugins can be used in main process. Like `vite-plugin-aliases`
    alias: {
      // 'key': 'value',
    },
  },
});