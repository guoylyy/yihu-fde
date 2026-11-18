// 经验库 → Obsidian 单向同步(FDE 写, Obsidian 读; 不读回、不监听)
// 目标: <obsidianVaultPath>/07.FDE经验/<项目名 | 未归类>/<YYYY-MM-DD>-<标题 slug>.md
// 数据库是主, 文件是副本: 写文件失败返回 { ok:false, error }, 不动数据库里的经验本身
// 只写 07.FDE经验/ 之下; 换路径(改了标题/项目)时只删自己写过的旧文件(frontmatter fde_id 对得上才删)
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import prisma from '../lib/prisma.js'
import { getSetting } from '../lib/settings.js'

export const FDE_DIR = '07.FDE经验'
export const UNFILED = '未归类'
const MAX_PATH = 191 // dev_experiences.obsidian_path 列宽

const SOURCE_LABEL = { PLATFORM_ASSISTANT: '平台助手', HERMES: 'Hermes', CLAUDE_CODE: 'Claude Code', CODEX: 'Codex', PASTE: '粘贴' }
const STAGE_LABEL = { REQUIREMENT: '需求', DESIGN: '设计', CODING: '编码', TEST: '测试', RETRO: '复盘', GENERAL: '通用' }

// 业务时区固定 UTC+8(与 okrRules 一致), 不依赖运行机器的 TZ
const CST_MS = 8 * 3600 * 1000
const cst = (d) => new Date(new Date(d).getTime() + CST_MS).toISOString()
export const cstDate = (d) => cst(d).slice(0, 10)
export const cstIso = (d) => cst(d).slice(0, 19) + '+08:00'
const cstMinute = (d) => cst(d).slice(0, 16).replace('T', ' ')

/** 设置里的 vault 路径 → 绝对路径(支持 ~) */
export async function vaultRoot() {
  const raw = String((await getSetting('obsidianVaultPath')) || '').trim()
  if (!raw) throw new Error('没有配置 obsidianVaultPath')
  const p = raw === '~' ? os.homedir() : raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw
  if (!path.isAbsolute(p)) throw new Error(`obsidianVaultPath 必须是绝对路径：${raw}`)
  return path.resolve(p)
}

/** 文件/目录名: 去掉 Obsidian/文件系统不认的字符, 截到 max 字 */
export function safeName(s, max = 60, { dashSpaces = false } = {}) {
  let t = String(s ?? '')
    .replace(/[\\/:*?"<>|#^[\]{}`\u0000-\u001f\u007f]/g, '')
    .replace(/^[.\s]+/, '')
    .trim()
  if (dashSpaces) t = t.replace(/\s+/g, '-').replace(/-+/g, '-')
  else t = t.replace(/\s+/g, ' ')
  t = [...t].slice(0, max).join('').replace(/[-.\s]+$/, '')
  return t
}

/** YAML 标量: 普通词原样, 其余用 JSON 双引号(合法 YAML) */
export function yamlScalar(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = String(v)
  const plain = /^[\p{L}\p{N}_][\p{L}\p{N}_.\- ]*$/u.test(s) && !/\s$/.test(s) &&
    !/^(?:true|false|null|yes|no|on|off|~|[-+]?[\d.]+(?:e[-+]?\d+)?)$/i.test(s)
  return plain ? s : JSON.stringify(s)
}

/** 经验 → markdown(frontmatter + 正文 + 来源) */
export function renderExperience(exp, { project, conversation } = {}) {
  const tags = Array.isArray(exp.tags) ? exp.tags.map(String).filter(Boolean) : []
  const fm = [
    '---',
    `fde_id: ${exp.id}`,
    `kind: ${exp.kind}`,
    `project: ${project ? yamlScalar(project.name) : 'null'}`,
    `conversation_id: ${exp.conversationId != null ? exp.conversationId : 'null'}`,
    `tags: [${tags.map(yamlScalar).join(', ')}]`,
    `reusable_level: ${exp.reusableLevel}`,
    `created_at: ${cstIso(exp.createdAt)}`,
    '---'
  ]
  const src = []
  if (conversation) {
    const when = conversation.startedAt || conversation.createdAt
    const meta = [SOURCE_LABEL[conversation.source] || conversation.source, STAGE_LABEL[conversation.stage] || conversation.stage, when ? cstMinute(when) : null].filter(Boolean)
    src.push(`- 会话：${conversation.title || `#${conversation.id}`}（${meta.join(' / ')}）`)
  } else if (exp.conversationId != null) src.push(`- 会话：#${exp.conversationId}（已删除）`)
  src.push(`- 项目：${project ? project.name : UNFILED}`)
  return `${fm.join('\n')}\n\n# ${exp.title}\n\n${String(exp.body || '').trim()}\n\n## 来源\n${src.join('\n')}\n`
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** 文件 frontmatter 里的 fde_id; 读不到返回 null */
async function fileFdeId(file) {
  try {
    const head = (await fs.readFile(file, 'utf8')).slice(0, 2000)
    const m = head.match(/^---\n[\s\S]*?^fde_id:\s*(\d+)\s*$/m)
    return m ? m[1] : null
  } catch { return null }
}

const exists = (p) => fs.access(p).then(() => true, () => false)

/**
 * 同步一条经验到 vault。成功写回 obsidianPath / syncedAt。
 * @returns {Promise<{ ok: true, path: string } | { ok: false, error: string }>}
 */
export async function syncExperience(id) {
  const exp = await prisma.devExperience.findFirst({ where: { id: BigInt(id), deletedAt: null } })
  if (!exp) return { ok: false, error: '经验不存在' }
  try {
    const [project, conversation] = await Promise.all([
      exp.projectId ? prisma.project.findUnique({ where: { id: exp.projectId }, select: { id: true, name: true } }) : null,
      exp.conversationId ? prisma.devConversation.findFirst({ where: { id: exp.conversationId, deletedAt: null }, select: { id: true, title: true, source: true, stage: true, startedAt: true, createdAt: true } }) : null
    ])
    const root = path.join(await vaultRoot(), FDE_DIR)
    const dir = path.join(root, safeName(project?.name, 40) || UNFILED)
    const base = `${cstDate(exp.createdAt)}-${safeName(exp.title, 60, { dashSpaces: true }) || 'untitled'}`
    let file = path.join(dir, `${base}.md`)
    // 同名文件是别的经验写的 → 加 id 后缀, 不覆盖别人
    if (file !== exp.obsidianPath && await exists(file)) {
      const owner = await fileFdeId(file)
      if (owner !== String(exp.id)) file = path.join(dir, `${base}-${exp.id}.md`)
    }
    if (file.length > MAX_PATH) return { ok: false, error: `路径过长（${file.length} > ${MAX_PATH}），请缩短标题或项目名` }

    await fs.mkdir(dir, { recursive: true })
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
    await fs.writeFile(tmp, renderExperience(exp, { project, conversation }), 'utf8')
    await fs.rename(tmp, file)

    // 路径变了(改了标题/项目): 删掉自己上次写的旧文件, 不留副本
    const old = exp.obsidianPath
    if (old && old !== file && isInside(old, root) && (await fileFdeId(old)) === String(exp.id)) {
      await fs.unlink(old).catch(() => {})
    }

    const now = new Date()
    await prisma.devExperience.update({ where: { id: exp.id }, data: { obsidianPath: file, syncedAt: now, updatedAt: now } })
    return { ok: true, path: file }
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300) }
  }
}

/** 是否已是最新: 同步过、之后没改过、文件还在当前 vault 里 */
export async function isSynced(exp, root) {
  return !!(exp.obsidianPath && exp.syncedAt && exp.updatedAt <= exp.syncedAt &&
    isInside(exp.obsidianPath, root) && await exists(exp.obsidianPath))
}

/**
 * 批量补同步: 已是最新的跳过, 其余逐条同步
 * @param {object} where 额外筛选(如 { projectId })
 */
export async function syncAll(where = {}) {
  const rows = await prisma.devExperience.findMany({ where: { ...where, deletedAt: null }, orderBy: { id: 'asc' } })
  const out = { synced: 0, skipped: 0, failed: 0, errors: [] }
  const root = path.join(await vaultRoot(), FDE_DIR)
  for (const exp of rows) {
    if (await isSynced(exp, root)) { out.skipped++; continue }
    const r = await syncExperience(exp.id)
    if (r.ok) out.synced++
    else {
      out.failed++
      if (out.errors.length < 20) out.errors.push({ id: String(exp.id), error: r.error })
    }
  }
  return out
}
