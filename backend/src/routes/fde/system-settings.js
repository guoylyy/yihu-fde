// 系统设置(管理员): 接入以虎 One 的情况(只读) + 本系统开关(部门负责人规则、消息转发)
// 大模型配置另见 llm-configs.js
import express from 'express'
import { internalAuth, requirePermission, getRoleName } from '../../lib/auth.js'
import { describeSettings, saveSettings, mcpUrl } from '../../lib/settings.js'
import { oidcConfig } from '../../lib/oidc.js'
import { appInfo } from '../../lib/yihuOne.js'
import { ON_YIHU_ONE } from '../../lib/platform.js'
import { lastDirectorySync } from '../../services/directorySync.js'
import { logInternalAction } from '../../lib/audit.js'

const router = express.Router()
router.use(internalAuth)
router.use(requirePermission('system.manage'))

async function snapshot(req) {
  const cfg = oidcConfig()
  const app = cfg.enabled ? await appInfo() : null
  return {
    settings: describeSettings(),
    platform: cfg.enabled ? {
      name: cfg.name,
      url: app?.platformUrl || cfg.issuer,
      space: app?.space || null,
      hosted: ON_YIHU_ONE,
      autoCreate: cfg.autoCreate,
      defaultRole: cfg.defaultRole,
      defaultRoleName: getRoleName(cfg.defaultRole),
      adminRoles: cfg.adminRoles,
      // 个人 AI 工具经平台 MCP 网关接入; 本系统的 MCP 地址只给 Agent 专属 Key 用
      gatewayMcpUrl: app?.platformUrl ? `${app.platformUrl.replace(/\/+$/, '')}/api/mcp` : null,
      agentMcpUrl: mcpUrl(req),
      directorySync: lastDirectorySync()
    } : null
  }
}

router.get('/', async (req, res) => {
  res.json({ code: 0, data: await snapshot(req) })
})

// body: { values: { 'auth.leaderIsManager': true, ... } }  null = 恢复默认
router.put('/', async (req, res) => {
  const values = req.body?.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return res.status(400).json({ code: 1001, message: 'values 必须是对象' })
  }
  try {
    const keys = await saveSettings(values, req.user.userId)
    logInternalAction(req, 'SYSTEM_SETTINGS_UPDATE', { resourceType: 'appSetting', details: { values } })
    res.json({ code: 0, data: { updated: keys, ...(await snapshot(req)) } })
  } catch (e) {
    const invalid = !e.code
    if (!invalid) console.error('[system-settings:update]', e)
    res.status(invalid ? 400 : 500).json({ code: invalid ? 1001 : 9001, message: e.message })
  }
})

export default router
