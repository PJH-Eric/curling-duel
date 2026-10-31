import { defineConfig } from 'vite'

// GitHub Pages 專案頁需要子路徑；以 VITE_BASE 覆寫（預設 './' 相對路徑，本機與 Pages 皆可用）
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  server: { port: 5173, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
})
