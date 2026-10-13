import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // 资源用相对路径: 配合 index.html 的 <base href>, 同一份构建既能独立部署在 /, 也能装在以虎 One 的 /apps/<code>/ 下
  base: './',
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()]
    }),
    Components({
      resolvers: [ElementPlusResolver()]
    })
  ],
  build: {
    rollupOptions: {
      output: {
        // 第三方库拆成独立文件: 各页面共用、浏览器单独缓存, 业务代码更新时不用重新下载
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(echarts|zrender)\//.test(id)) return 'vendor-echarts'
          if (/node_modules\/(element-plus|@element-plus)\//.test(id)) return 'vendor-element'
          if (/node_modules\/(vue|@vue|vue-router|pinia|vue-i18n|@intlify)\//.test(id)) return 'vendor-vue'
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '::1'
    ],
    proxy: {
      // 后端地址可用 VITE_API_TARGET 覆盖(如本地同时起两套实例)
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3005',
        changeOrigin: true,
        // 带上浏览器看到的主机名: 统一登录的回调地址按它推导
        configure: (proxy) => proxy.on('proxyReq', (proxyReq, req) => proxyReq.setHeader('x-forwarded-host', req.headers.host))
      },
      // 本地存储驱动的上传文件由后端托管
      '/uploads': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3005',
        changeOrigin: true
      }
    }
  }
})
