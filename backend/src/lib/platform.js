// 装在以虎 One 平台上运行(托管应用)时的默认配置
//
// 平台给每个托管应用注入这些环境变量(见以虎 One 开发中心「应用部署规范」):
//   YH_CLIENT_ID / YH_CLIENT_SECRET   本应用在平台登记的凭证(也是 OIDC 的 client_id / client_secret)
//   YH_APP_URL                        本应用的公网地址, 如 https://one.example.com/apps/fde
//   YH_WEB_URL                        平台地址(浏览器打开的), 即 OIDC issuer
//   YH_API_URL                        平台的容器网络地址 http://yh-console:3105(服务端直连, 不绕公网)
//   DATABASE_URL                      平台建好的 MySQL 库
//
// 有 YH_CLIENT_ID 时, 把它们换算成本系统自己的配置项: 只补没配的, 显式配置的环境变量一律优先。
// 必须在读取这些配置的模块(auth.js 的 JWT_SECRET、storage.js、oidc.js)之前加载: index.js 第二行就 import 它。
import crypto from 'node:crypto'
import fs from 'node:fs'

const env = process.env
const trim = (s) => String(s || '').replace(/\/+$/, '')
const setDefault = (k, v) => { if ((env[k] == null || env[k] === '') && v) env[k] = v }

export const ON_YIHU_ONE = !!(env.YH_CLIENT_ID && env.YH_CLIENT_SECRET)

if (ON_YIHU_ONE) {
  const appUrl = trim(env.YH_APP_URL)
  setDefault('PUBLIC_BASE_URL', appUrl)
  // 统一登录: 授权页用平台的公网地址, 换 token / 取用户信息走容器网络
  setDefault('OIDC_ISSUER', trim(env.YH_WEB_URL))
  setDefault('OIDC_INTERNAL_URL', trim(env.YH_API_URL))
  setDefault('OIDC_CLIENT_ID', env.YH_CLIENT_ID)
  setDefault('OIDC_CLIENT_SECRET', env.YH_CLIENT_SECRET)
  setDefault('OIDC_REDIRECT_URI', appUrl && `${appUrl}/api/auth/oidc/callback`)
  setDefault('OIDC_NAME', '以虎 One')
  // 登录 token 的签名密钥: 没单独配时由平台凭证派生(每套安装不同、重启不变); 平台重置凭证后大家重新登录一次
  setDefault('JWT_SECRET', crypto.createHmac('sha256', env.YH_CLIENT_SECRET).update('fde-jwt-secret').digest('hex'))
  // 平台只备份 /data: 上传的文件放那里
  if (fs.existsSync('/data')) setDefault('UPLOAD_DIR', '/data/uploads')
  // 前端构建产物(根目录 Dockerfile 打进镜像)由后端直接托管
  if (fs.existsSync('/app/public/index.html')) setDefault('STATIC_DIR', '/app/public')
}

/**
 * 请求所在的路径前缀: 平台把 /apps/<code>/... 剥掉前缀再转进来, 前缀放在 X-Forwarded-Prefix 里。
 * 只认 /apps/<code> 这种形状(防止伪造的头把页面里的地址改到别处); 直连 / 独立部署时为空串
 */
export function basePathOf(req) {
  const p = String(req?.headers?.['x-forwarded-prefix'] || '').split(',')[0].trim().replace(/\/+$/, '')
  return /^\/apps\/[a-z0-9-]+$/.test(p) ? p : ''
}
