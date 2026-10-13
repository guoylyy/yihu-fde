// 系统设置(管理员): 品牌外观、访问地址; 大模型配置另见 llm-configs.js
// 每项的取值优先级与生效方式见 lib/settings.js
import express from 'express'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { describeSettings, saveSettings, publicBaseUrl, mcpUrl } from '../../lib/settings.js'
import { oidcConfig } from '../../lib/oidc.js'
import { ON_YIHU_ONE } from '../../lib/platform.js'
import { getBrand } from '../../config/brand.js'
import { logInternalAction } from '../../lib/audit.js'

const router = express.Router()
router.use(internalAuth)
router.use(requirePermission('system.manage'))

function snapshot(req) {
  const oidc = oidcConfig()
  return {
    settings: describeSettings(),
    effective: { brand: getBrand(), publicBaseUrl: publicBaseUrl(req), mcpUrl: mcpUrl(req) },
    // 只读: 登录方式由部署配置决定(凭证不进库)
    login: {
      password: !['false', '0', 'no', 'off'].includes(String(process.env.PASSWORD_LOGIN ?? '').toLowerCase()),
      oidc: oidc.enabled ? { name: oidc.name, issuer: oidc.issuer, autoCreate: oidc.autoCreate, defaultRole: oidc.defaultRole } : null,
      onYihuOne: ON_YIHU_ONE
    }
  }
}

router.get('/', (req, res) => {
  res.json({ code: 0, data: snapshot(req) })
})

// body: { values: { 'brand.name': 'Acme', 'url.mcp': null, ... } }  null/空串 = 清除, 回到环境变量或默认
router.put('/', async (req, res) => {
  const values = req.body?.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return res.status(400).json({ code: 1001, message: 'values 必须是对象' })
  }
  try {
    const keys = await saveSettings(values, req.user.userId)
    logInternalAction(req, 'SYSTEM_SETTINGS_UPDATE', { resourceType: 'appSetting', details: { values } })
    res.json({ code: 0, data: { updated: keys, ...snapshot(req) } })
  } catch (e) {
    // 校验失败的提示直接给用户; 其余是库错误
    const invalid = !e.code
    if (!invalid) console.error('[system-settings:update]', e)
    res.status(invalid ? 400 : 500).json({ code: invalid ? 1001 : 9001, message: e.message })
  }
})

export default router
