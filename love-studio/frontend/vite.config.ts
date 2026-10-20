import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two entry points: debug.html is the app (prompt console + visual novel);
// index.html only redirects / to it — the old standalone galgame frontend was
// removed on 2026-09-24.
// 卡带带来的页面(素材筛选页一类):文件在才打包 —— 生成公开版时卡带连同它的页面一起删掉
const CARTRIDGE_PAGES = ['sfx.html'].filter((f) => existsSync(resolve(__dirname, f)))

// Love Studio 的端口 / 地址约定(见仓库根的 README.md):
//   前端(http://127.0.0.1:5180) -> 后端(http://127.0.0.1:8000) 走 /api 反代。
//   dev 和 preview 共用 5180,同一时刻只能开一个(strictPort:true,占用了就直接报错,
//   不会悄悄退到 5181 —— 不然 http://127.0.0.1:5180/api/health 这条健康契约就不成立了)。
// 端口可用 STUDIO_PORT / VITE_PORT 覆盖;VITE_API_BASE_URL 照旧有效(见 frontend/.env.example)。
const STUDIO_PORT = Number(process.env.STUDIO_PORT || process.env.VITE_PORT || 5180)
const BACKEND = process.env.STUDIO_API_TARGET || 'http://127.0.0.1:8000'

// 后端所有接口和素材都在 /api 下(blobs / sprite-packs / scene-packs / tts ...),
// 所以一条 /api 规则就够。改端口 = 改 VITE_API_BASE_URL,但网页上的 5180/api/health 永远可用。
const proxy = {
  '/api': { target: BACKEND, changeOrigin: true },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: STUDIO_PORT,
    strictPort: true,
    proxy,
  },
  preview: {
    host: '127.0.0.1',
    port: STUDIO_PORT,
    strictPort: true,
    proxy,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        debug: resolve(__dirname, 'debug.html'),
        ...Object.fromEntries(CARTRIDGE_PAGES.map((f) => [f.replace(/\.html$/, ''), resolve(__dirname, f)])),
      },
    },
  },
})