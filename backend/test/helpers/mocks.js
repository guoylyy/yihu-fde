// 测试辅助 - 通用 mock 工具
import { mock } from 'node:test'

/**
 * Mock Prisma client - 全部 model 替换为可配置的 mock
 * @param {object} overrides - 各 model 的方法 mock
 * @returns {{prisma: object, restore: function}}
 *
 * 用法：
 *   const { prisma, restore } = mockPrisma({
 *     user: { findUnique: async () => ({ id: 1, name: 'test' }) },
 *     notification: { create: async () => ({ id: 100 }) }
 *   })
 *   // ... 测试代码 ...
 *   restore()
 */
export function mockPrisma(overrides = {}) {
  const prismaMock = {}
  // 默认每个 model 的方法返回 undefined，让测试明确覆盖需要的
  const DEFAULT_MODELS = [
    'user', 'notification', 'activity', 'engineer',
    'customer', 'project', 'task', 'timesheet', 'comment',
    'subtask', 'skill', 'engineerSkill', 'milestone', 'issue', 'risk',
    'projectMember', 'contact', 'deliverable',
    'projectReview', 'engineerCertification', 'knowledgeArticle',
    'engineerStats', 'contract', 'invoice', 'auditLog'
  ]
  for (const model of DEFAULT_MODELS) {
    prismaMock[model] = overrides[model] || new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'then') return undefined // 防止被 await
        return target[prop] || (async () => {
          throw new Error(`prisma.${model}.${String(prop)} not mocked`)
        })
      }
    })
  }
  // 接受动态 model 名（兼容）
  for (const [k, v] of Object.entries(overrides)) {
    prismaMock[k] = v
  }
  return { prisma: prismaMock, restore: () => {} }
}

/**
 * Mock 环境变量
 * @param {object} env
 * @returns {function} restore 函数
 */
export function mockEnv(env = {}) {
  const original = {}
  for (const [k, v] of Object.entries(env)) {
    original[k] = process.env[k]
    process.env[k] = v
  }
  return () => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/**
 * 捕获 console.log / console.error
 * @returns {{logs: string[], errors: string[], restore: function}}
 */
export function captureConsole() {
  const logs = []
  const errors = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...args) => logs.push(args.map(String).join(' '))
  console.error = (...args) => errors.push(args.map(String).join(' '))
  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog
      console.error = origErr
    }
  }
}

/**
 * 延迟辅助
 */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 常用测试数据
 */
export const FIXTURES = {
  user: (overrides = {}) => ({
    id: 1n,
    username: 'testuser',
    name: '测试用户',
    email: 'test@example.com',
    phone: '13800000000',
    role: 'FDE_ENGINEER',
    status: 1,
    notificationPrefs: null,
    ...overrides
  }),
  notification: (overrides = {}) => ({
    id: 100n,
    userId: 1n,
    type: 'TEST',
    title: '测试通知',
    body: null,
    link: null,
    data: null,
    readAt: null,
    createdAt: new Date(),
    ...overrides
  }),
  engineer: (overrides = {}) => ({
    id: 10n,
    userId: 1n,
    level: 3,
    title: '工程师',
    available: 1,
    skills: [],
    ...overrides
  })
}
