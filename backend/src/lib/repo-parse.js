// 代码仓库地址解析：从 GitHub/Gitee/GitLab 地址提取 owner/repo，
// 并（尽力）调用对应平台 API 拿到默认分支 / 描述(见 gitHost.js)。
// 私有仓库需要在 .env 配置 GITHUB_TOKEN / GITEE_ACCESS_TOKEN / GITLAB_TOKEN，否则只做 URL 解析。
import { fetchRepoInfo, SYNC_PROVIDERS } from './gitHost.js'

function detectProvider(host) {
  const h = (host || '').toLowerCase()
  if (h.includes('gitee.com')) return 'GITEE'
  if (h.includes('github.com')) return 'GITHUB'
  if (h.includes('gitlab')) return 'GITLAB'
  return 'OTHER'
}

/**
 * 从各种格式的仓库地址解析出 { provider, host, owner, repo }
 * 支持：
 *   https://gitee.com/owner/repo(.git)?(/tree/xxx)?
 *   http://...
 *   git@gitee.com:owner/repo.git
 */
export function parseRepoUrl(raw) {
  const url = String(raw || '').trim()
  if (!url) return null

  let host = '', pathPart = ''
  const ssh = url.match(/^git@([^:]+):(.+)$/)
  if (ssh) {
    host = ssh[1]
    pathPart = ssh[2]
  } else {
    let u
    try { u = new URL(url) } catch { return null }
    host = u.hostname
    pathPart = u.pathname
  }

  const segs = pathPart.replace(/^\/+/, '').split('/').filter(Boolean)
  if (segs.length < 2) return null
  const provider = detectProvider(host)
  const owner = segs[0]
  // GitLab 支持多级分组(group/sub/repo), 路径到 /-/ 为止; 其余平台固定 owner/repo 两段
  const pathSegs = provider === 'GITLAB'
    ? segs.slice(0, segs.indexOf('-') === -1 ? segs.length : segs.indexOf('-'))
    : segs.slice(0, 2)
  pathSegs[pathSegs.length - 1] = pathSegs[pathSegs.length - 1].replace(/\.git$/i, '')
  const repo = pathSegs[pathSegs.length - 1]
  if (!owner || !repo || pathSegs.length < 2) return null

  return { provider, host, owner, repo, fullPath: pathSegs.join('/') }
}

/**
 * 解析仓库地址并尽力补全默认分支/描述。
 * 返回：{ provider, owner, repo, name, defaultBranch, description, private, apiOk, note }
 */
export async function resolveRepo(raw) {
  const parsed = parseRepoUrl(raw)
  if (!parsed) return { ok: false, message: '无法识别仓库地址' }

  const { provider, owner, repo } = parsed
  // 基础结果：至少能从 URL 得到仓库名（slug）
  const result = {
    provider, owner, repo,
    name: repo,
    defaultBranch: null,
    description: null,
    private: null,
    apiOk: false,
    note: ''
  }

  if (!SYNC_PROVIDERS.includes(provider)) {
    result.note = '该平台暂不支持自动读取默认分支，已按地址填充仓库名'
    return { ok: true, ...result }
  }
  const info = await fetchRepoInfo(raw)
  if (info.ok) {
    Object.assign(result, { name: info.name, defaultBranch: info.defaultBranch, description: info.description, private: info.private, apiOk: true })
  } else {
    result.note = info.status === 404
      ? '仓库不存在或为私有（配置 GITHUB_TOKEN / GITEE_ACCESS_TOKEN / GITLAB_TOKEN 后可读取私有仓库）'
      : '未能读取仓库信息，已按地址填充仓库名'
  }

  return { ok: true, ...result }
}
