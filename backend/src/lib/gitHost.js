// 代码托管平台 API 封装 —— 拉取仓库信息 / 分支 / 提交, 供关联仓库与提交同步用。
//
// 支持 GitHub、Gitee(两者 v3/v5 接口形状一致)、GitLab(含自建, 域名里带 gitlab 即可)。
// 私有仓库需要令牌: GITHUB_TOKEN / GITEE_ACCESS_TOKEN / GITLAB_TOKEN; 不配只能读公开仓库。
import { parseRepoUrl } from './repo-parse.js'

const TIMEOUT_MS = 10000
export const SYNC_PROVIDERS = ['GITHUB', 'GITEE', 'GITLAB']

/** 各平台的请求方式: 接口前缀 + 认证(GitHub/GitLab 走请求头, Gitee 走 access_token 参数) */
function client(parsed) {
  const { provider, host, owner, repo, fullPath } = parsed
  if (provider === 'GITHUB') {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'fde-platform' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    return { label: 'GitHub', base: `https://api.github.com/repos/${owner}/${repo}`, headers, query: {} }
  }
  if (provider === 'GITEE') {
    const query = process.env.GITEE_ACCESS_TOKEN ? { access_token: process.env.GITEE_ACCESS_TOKEN } : {}
    return {
      label: 'Gitee',
      base: `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      headers: { 'User-Agent': 'fde-platform' },
      query
    }
  }
  if (provider === 'GITLAB') {
    const headers = process.env.GITLAB_TOKEN ? { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN } : {}
    return { label: 'GitLab', base: `https://${host}/api/v4/projects/${encodeURIComponent(fullPath)}`, headers, query: {} }
  }
  return null
}

async function getJson(c, pathPart, params = {}) {
  const qs = new URLSearchParams({ ...c.query, ...params })
  const url = `${c.base}${pathPart}${qs.toString() ? `?${qs}` : ''}`
  let res
  try {
    res = await fetch(url, { headers: c.headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    return { ok: false, message: `请求 ${c.label} 失败: ${e.message}` }
  }
  if (!res.ok) {
    // 401/403=令牌问题, 404=仓库不存在/私有无权限
    let body = ''
    try { body = (await res.text()).slice(0, 200) } catch {}
    return { ok: false, status: res.status, message: `${c.label} 返回 ${res.status} ${body}`.trim() }
  }
  try {
    return { ok: true, data: await res.json() }
  } catch (e) {
    return { ok: false, message: `解析 ${c.label} 响应失败: ${e.message}` }
  }
}

function prepare(url) {
  const parsed = parseRepoUrl(url)
  if (!parsed) return { error: '无法识别仓库地址' }
  const c = client(parsed)
  if (!c) return { error: `暂不支持 ${parsed.provider} 平台的同步` }
  return { parsed, c }
}

/**
 * 仓库基本信息(默认分支/描述/是否私有)
 * @returns {Promise<{ok: boolean, name?, defaultBranch?, description?, private?, status?, message?}>}
 */
export async function fetchRepoInfo(url) {
  const { parsed, c, error } = prepare(url)
  if (error) return { ok: false, message: error }
  const r = await getJson(c, '')
  if (!r.ok) return r
  const d = r.data || {}
  if (parsed.provider === 'GITLAB') {
    return { ok: true, name: d.path || parsed.repo, defaultBranch: d.default_branch || null, description: d.description || null, private: d.visibility ? d.visibility !== 'public' : null }
  }
  return { ok: true, name: d.path || d.name || parsed.repo, defaultBranch: d.default_branch || null, description: d.description || null, private: !!d.private }
}

/**
 * 仓库的所有分支(用于跨分支聚合最新提交)
 * @returns {Promise<{ok: boolean, branches?: Array<{name: string, sha: string}>, status?: number, message?: string}>}
 */
export async function fetchBranches(url) {
  const { parsed, c, error } = prepare(url)
  if (error) return { ok: false, message: error }
  const r = await getJson(c, parsed.provider === 'GITLAB' ? '/repository/branches' : '/branches', { per_page: '100' })
  if (!r.ok) return r
  if (!Array.isArray(r.data)) return { ok: false, message: `${c.label} 分支响应格式异常` }
  const branches = r.data.map(b => ({ name: b.name, sha: b.commit?.sha || b.commit?.id })).filter(b => b.name)
  return { ok: true, branches }
}

/**
 * 拉取提交列表(默认取最近一页)
 * @param {string} url    仓库地址(https / git@ 均可)
 * @param {object} opts
 * @param {string} [opts.branch]  分支名
 * @param {string|Date} [opts.since]  只取该时间之后的提交, 增量同步用
 * @param {number} [opts.perPage=50]  每页条数(上限 100)
 * @returns {Promise<{ok: boolean, commits?: Array, status?: number, message?: string}>}
 */
export async function fetchCommits(url, { branch, since, perPage = 50 } = {}) {
  const { parsed, c, error } = prepare(url)
  if (error) return { ok: false, message: error }
  const params = { per_page: String(Math.min(Math.max(perPage, 1), 100)) }
  if (since) params.since = since instanceof Date ? since.toISOString() : String(since)
  const gitlab = parsed.provider === 'GITLAB'
  if (branch) params[gitlab ? 'ref_name' : 'sha'] = branch
  const r = await getJson(c, gitlab ? '/repository/commits' : '/commits', params)
  if (!r.ok) return r
  if (!Array.isArray(r.data)) return { ok: false, message: `${c.label} 提交响应格式异常(非数组)` }
  const commits = r.data.map(gitlab ? normalizeGitlabCommit : normalizeCommit).filter(Boolean)
  return { ok: true, commits }
}

function commitRecord({ sha, message, author, email, date, url, fallbackAuthor }) {
  const happenedAt = date ? new Date(date) : null
  if (!sha || !happenedAt || isNaN(happenedAt.getTime())) return null
  const msg = (message || '').trim()
  return {
    sha,
    title: (msg.split('\n')[0] || sha.slice(0, 8)).slice(0, 500),
    author: (author || fallbackAuthor || '').slice(0, 200) || null,
    url: url || null,
    happenedAt,
    raw: { sha, message: msg, author, email, date, html_url: url }
  }
}

/** GitHub / Gitee: { sha, html_url, author?: { login }, commit: { message, author: { name, email, date }, committer: { date } } } */
function normalizeCommit(c) {
  if (!c) return null
  const commit = c.commit || {}
  return commitRecord({
    sha: c.sha,
    message: commit.message,
    author: commit.author?.name,
    email: commit.author?.email,
    date: commit.committer?.date || commit.author?.date,
    url: c.html_url,
    fallbackAuthor: c.author?.login
  })
}

/** GitLab: { id, message, author_name, author_email, committed_date, web_url } */
function normalizeGitlabCommit(c) {
  if (!c) return null
  return commitRecord({
    sha: c.id,
    message: c.message || c.title,
    author: c.author_name,
    email: c.author_email,
    date: c.committed_date || c.created_at,
    url: c.web_url
  })
}
