// Prisma 客户端单例
// 2026-07-07: connection_limit 21 → 10，避免 60s 定时调用打满连接池
// (AdminLayout.vue 1分钟调度一次 fde.timesheets.pending + fde.notifications.list)
// 21 → 10 保留足够余量，多人并发也不会超时
// 测试、脚本直接 import 本模块时也要拿到 DATABASE_URL: 读 backend/.env(不覆盖已有环境变量, 平台上注入的照常优先)
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = globalThis.__prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL + '?connection_limit=10'
    }
  }
})

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}

export default prisma