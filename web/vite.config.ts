import { defineConfig } from 'vite'

const preparedServer = 'http://127.0.0.1:8000'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/data': preparedServer,
      '/tables': preparedServer,
      '/structures': preparedServer,
    },
  },
})
