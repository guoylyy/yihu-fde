import 'dotenv/config'
// 装在以虎 One 上时把平台注入的环境变量换算成本系统的配置, 必须先于其他模块加载
import { basePathOf } from './lib/platform.js'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import { startCronJobs } from './lib/cron.js'
import { loadRolePermissions, loadRoles } from './lib/auth.js'
import { editionGuard, editionName, enabledModuleList, ALL_MODULES } from './config/edition.js'
import { STORAGE_DRIVER, UPLOAD_DIR, LOCAL_URL_PREFIX } from './lib/storage.js'
import { mountMcp } from './mcp/index.js'

import authRouter from './routes/auth.js'
import publicEditionRouter from './routes/public/edition.js'
// 工作台 / 项目 / 任务
import meRouter from './routes/fde/me.js'
import customersRouter from './routes/fde/customers.js'
import projectsRouter from './routes/fde/projects.js'
import projectRecordsRouter from './routes/fde/project-records.js'
import decompositionRouter from './routes/fde/decomposition.js'
import tasksRouter from './routes/fde/tasks.js'
import subtasksRouter from './routes/fde/subtasks.js'
import taskDependenciesRouter from './routes/fde/task-dependencies.js'
import devDispatchRouter from './routes/fde/dev-dispatch.js'
import commentsRouter from './routes/fde/comments.js'
import activitiesRouter from './routes/fde/activities.js'
import timesheetsRouter from './routes/fde/timesheets.js'
import reportsRouter from './routes/reports/index.js'
import ideasRouter from './routes/fde/ideas.js'
// 工程师与智能体
import engineersRouter from './routes/fde/engineers.js'
import engineerStatsRouter from './routes/fde/engineerStats.js'
import engineerProfilesRouter from './routes/fde/engineer-profiles.js'
import skillsRouter from './routes/fde/skills.js'
import agentProfilesRouter from './routes/fde/agent-profiles.js'
import agentPresenceRouter from './routes/fde/agent-presence.js'
import agentConversationsRouter from './routes/fde/agent-conversations.js'
import apiKeysRouter from './routes/fde/api-keys.js'
import onboardingRouter from './routes/fde/onboarding.js'
// 知识与资产
import knowledgeRouter from './routes/fde/knowledge.js'
import knowledgeChecklistRouter from './routes/fde/knowledge-checklists.js'
import assetsRouter from './routes/fde/assets.js'
import uploadsRouter from './routes/fde/uploads.js'
// 系统管理
import usersRouter from './routes/fde/users.js'
import teamsRouter from './routes/fde/teams.js'
import rolesRouter from './routes/fde/roles.js'
import rolePermissionsRouter from './routes/fde/rolePermissions.js'
import notificationsRouter from './routes/fde/notifications.js'
import auditLogsRouter from './routes/fde/audit-logs.js'
import llmConfigsRouter from './routes/fde/llm-configs.js'
import systemSettingsRouter from './routes/fde/system-settings.js'
import cardsRouter from './routes/fde/cards.js'
import { loadSettings } from './lib/settings.js'
import { APP_VERSION } from './lib/version.js'
import { usageMiddleware } from './lib/usage.js'

// Prisma 的 BigInt 主键默认无法 JSON.stringify
BigInt.prototype.toJSON = function () { return this.toString() }

const app = express()
const PORT = process.env.PORT || 3005

app.use(cors())

// 本地存储驱动: 上传文件由后端直接托管。用户上传的内容与后台同源, 加 sandbox CSP + nosniff,
// 防止上传的 HTML/SVG 在本域执行脚本读到登录 token
if (STORAGE_DRIVER === 'local') {
  app.use(LOCAL_URL_PREFIX, express.static(UPLOAD_DIR, {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => {
      res.setHeader('Content-Security-Policy', 'sandbox')
      res.setHeader('X-Content-Type-Options', 'nosniff')
    }
  }))
}

// MCP Server(智能体对接, API Key 鉴权): 自带 20mb json 限额, 须在全局 express.json 之前挂载
mountMcp(app)

app.use(express.json())

// 版本开关: 本实例未启用的模块一律 404(配了 ENABLED_MODULES / DISABLED_MODULES 才会收敛)
app.use(editionGuard)

app.use('/api/auth', authRouter)
app.use('/api/public/edition', publicEditionRouter)

// 关键操作的使用数据上报到以虎 One(请求成功后异步入队, 见 lib/usage.js)
app.use('/api/fde', usageMiddleware)

app.use('/api/fde/me', meRouter)
app.use('/api/fde/customers', customersRouter)
app.use('/api/fde/projects', projectsRouter)
app.use('/api/fde/project-records', projectRecordsRouter)
app.use('/api/fde/decomposition', decompositionRouter)
app.use('/api/fde/tasks', tasksRouter)
app.use('/api/fde/subtasks', subtasksRouter)
app.use('/api/fde/task-dependencies', taskDependenciesRouter)
app.use('/api/fde/dev-dispatches', devDispatchRouter)
app.use('/api/fde/comments', commentsRouter)
app.use('/api/fde/activities', activitiesRouter)
app.use('/api/fde/timesheets', timesheetsRouter)
app.use('/api/fde/reports', reportsRouter)
app.use('/api/fde/ideas', ideasRouter)

app.use('/api/fde/engineers', engineersRouter)
app.use('/api/fde/engineer-stats', engineerStatsRouter)
app.use('/api/fde/engineer-profiles', engineerProfilesRouter)
app.use('/api/fde/skills', skillsRouter)
app.use('/api/fde/agent-profiles', agentProfilesRouter)
app.use('/api/fde/agent-presence', agentPresenceRouter)
app.use('/api/fde/agent-conversations', agentConversationsRouter)
app.use('/api/fde/api-keys', apiKeysRouter)
app.use('/api/fde/onboarding', onboardingRouter)

app.use('/api/fde/knowledge/checklists', knowledgeChecklistRouter)
app.use('/api/fde/knowledge', knowledgeRouter)
app.use('/api/fde/assets', assetsRouter)
app.use('/api/fde/uploads', uploadsRouter)

app.use('/api/fde/users', usersRouter)
app.use('/api/fde/teams', teamsRouter)
app.use('/api/fde/roles', rolesRouter)
app.use('/api/fde/role-permissions', rolePermissionsRouter)
app.use('/api/fde/notifications', notificationsRouter)
app.use('/api/fde/audit-logs', auditLogsRouter)
app.use('/api/fde/llm-configs', llmConfigsRouter)
app.use('/api/fde/system-settings', systemSettingsRouter)
app.use('/api/fde/cards', cardsRouter)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION, timestamp: new Date().toISOString() })
})

// 前端页面: 配了 STATIC_DIR(装在以虎 One 上时根目录 Dockerfile 会配)就由后端托管; 独立部署用 frontend/ 的 nginx 镜像。
// 平台上的地址带前缀(/apps/<code>/), 返回 index.html 时把 <base href> 换成实际前缀, 页面里的资源、路由、接口都跟着走
const STATIC_DIR = process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR)
if (STATIC_DIR && fs.existsSync(path.join(STATIC_DIR, 'index.html'))) {
  const indexHtml = fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf8')
  const page = (req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.type('html').send(indexHtml.replace('<base href="/">', `<base href="${basePathOf(req)}/">`))
  }
  app.get(['/', '/index.html'], page)
  app.use(express.static(STATIC_DIR, { index: false, maxAge: '1h' }))
  app.get(/^\/(?!api\/|uploads\/|health$).*/, page)
}

if (process.env.ENABLE_CRON !== 'false') startCronJobs()

// 先加载角色清单(roles 表 → 缓存), 再加载权限覆盖(覆盖行按角色缓存过滤)
loadRoles()
  .then(n => {
    console.log(`[roles] loaded ${n} roles`)
    return loadRolePermissions()
  })
  .then(n => { if (n) console.log(`[role-permissions] loaded ${n} overrides`) })
  .then(() => {
    const on = enabledModuleList()
    if (on.length < ALL_MODULES.length) {
      const off = ALL_MODULES.filter(m => !on.includes(m))
      console.log(`[edition] ${editionName()}: ${on.length}/${ALL_MODULES.length} modules on, off: ${off.join(', ')}`)
    }
  })
  .catch(e => console.error('[roles] load failed, using built-in roles and default permissions:', e.message))

// 系统设置(品牌/访问地址)要在接请求前生效; 读不到库就按环境变量起
loadSettings()
  .then(n => { if (n) console.log(`[settings] ${n} system settings applied`) })
  .catch(e => console.error('[settings] load failed, using defaults:', e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Backend listening on http://localhost:${PORT} (storage: ${STORAGE_DRIVER})`)
    })
  })
