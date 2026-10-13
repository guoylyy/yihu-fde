// FDE 平台 - 开发上手中心 (v2.0.0 #367)
// 目标: 新员工照 checklist 从零走到「第一次收工回写」全程不需要口头指导。
// 五步全部实时计算不落表(数据都在既有业务表里, 不引入新状态源):
//   1 配置包/专属Key  → 存在有效 PERSONAL ApiKey
//   2 MCP 连通        → 任一 Key lastUsedAt 非空
//   3 开始第一个任务  → 名下任务 startedAt 非空(或已过 IN_PROGRESS)
//   4 首次 #taskId 提交 → 名下任务出现「🔗 自动关联提交」评论(v1.9.1 固定文案)
//   5 首次收工回写    → 名下 DONE/VERIFIED 任务且该任务有本人评论
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import prisma from '../../lib/prisma.js'
import { internalAuth, hasRole } from '../../lib/auth.js'
import { generateApiKey } from '../../lib/apiKey.js'

const router = express.Router()
router.use(internalAuth)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TPL_DIR = path.join(__dirname, '../../templates/onboarding')
const PKG_KEY_NAME = '开发配置包'
const COMMIT_LINK_MARK = '🔗 自动关联提交'   // 与 services/repoSync.js 的评论文案保持一致
// 配置包里的 MCP 地址: 显式配置 > 对外基址 > 当前请求的来源(反向代理时取 X-Forwarded-*)
function mcpUrl(req) {
  if (process.env.PUBLIC_MCP_URL) return process.env.PUBLIC_MCP_URL
  if (process.env.PUBLIC_BASE_URL) return `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/mcp`
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0]
  const host = String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0]
  return `${proto}://${host}/api/mcp`
}

const STEP_DEFS = [
  { key: 'package', title: '下载开发配置包', desc: '一键生成专属密钥并下载 .mcp.json + fde-tasks 技能 + 上手教程' },
  { key: 'mcp', title: '打通 MCP 连接', desc: '按 README 放好配置, 在 Claude Code 里说「开工」, 平台检测到密钥被调用即完成' },
  { key: 'firstTask', title: '领取并开始第一个任务', desc: '在任务看板认领一个任务并置为「生产中」(开工口令会带你做)' },
  { key: 'firstCommit', title: '第一次带任务号的提交', desc: '提交信息末尾带 #任务号(如 fix: xxx #123), 等提交同步后自动点亮' },
  { key: 'firstDone', title: '完成第一次收工回写', desc: '任务做完: 评论汇总 + 置为「生产完成」(收工口令会带你做)' }
]

/**
 * 批量计算一组用户的五步完成情况。
 * 一次性预取全部相关行再内存归并 —— 团队 15 人规模, 比逐人查快且省连接。
 * @param {Array<{id: bigint}>} users
 * @returns {Map<string, {key: string, done: boolean}[]>} userId(string) -> steps
 */
async function computeSteps(users) {
  const userIds = users.map(u => u.id)
  const [keys, engineers] = await Promise.all([
    prisma.apiKey.findMany({
      where: { userId: { in: userIds }, scope: 'PERSONAL' },
      select: { userId: true, status: true, lastUsedAt: true }
    }),
    prisma.engineer.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true }
    })
  ])
  const engineerIds = engineers.map(e => e.id)
  const tasks = engineerIds.length ? await prisma.task.findMany({
    where: { assigneeId: { in: engineerIds }, deletedAt: null },
    select: { id: true, assigneeId: true, status: true, startedAt: true }
  }) : []
  const taskIds = tasks.map(t => t.id)
  const comments = taskIds.length ? await prisma.comment.findMany({
    where: { entity: 'task', entityId: { in: taskIds }, deletedAt: null },
    select: { entityId: true, authorId: true, content: true }
  }) : []

  const engineerByUser = new Map(engineers.map(e => [String(e.userId), e.id]))
  const tasksByEngineer = new Map()
  for (const t of tasks) {
    const k = String(t.assigneeId)
    if (!tasksByEngineer.has(k)) tasksByEngineer.set(k, [])
    tasksByEngineer.get(k).push(t)
  }
  const commentsByTask = new Map()
  for (const c of comments) {
    const k = String(c.entityId)
    if (!commentsByTask.has(k)) commentsByTask.set(k, [])
    commentsByTask.get(k).push(c)
  }

  const result = new Map()
  for (const u of users) {
    const uid = String(u.id)
    const myKeys = keys.filter(k => String(k.userId) === uid)
    const myTasks = tasksByEngineer.get(String(engineerByUser.get(uid) ?? '')) || []
    const myTaskComments = (t) => commentsByTask.get(String(t.id)) || []

    const hasActiveKey = myKeys.some(k => k.status === 1)
    const mcpUsed = myKeys.some(k => k.lastUsedAt)
    const started = myTasks.some(t => t.startedAt || ['IN_PROGRESS', 'DONE', 'VERIFIED'].includes(t.status))
    const commitLinked = myTasks.some(t => myTaskComments(t).some(c => c.content.includes(COMMIT_LINK_MARK)))
    const doneWritten = myTasks.some(t =>
      ['DONE', 'VERIFIED'].includes(t.status) &&
      myTaskComments(t).some(c => String(c.authorId) === uid && !c.content.includes(COMMIT_LINK_MARK))
    )

    const doneFlags = [hasActiveKey, mcpUsed, started, commitLinked, doneWritten]
    result.set(uid, STEP_DEFS.map((s, i) => ({ ...s, done: doneFlags[i] })))
  }
  return result
}

// 我的上手进度
router.get('/steps', async (req, res) => {
  try {
    const userId = BigInt(req.user.userId)
    const steps = (await computeSteps([{ id: userId }])).get(String(userId))
    res.json({ code: 0, data: { steps, doneCount: steps.filter(s => s.done).length, total: steps.length, mcpUrl: MCP_URL } })
  } catch (e) {
    console.error('[onboarding:steps]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 全员进度总览 (经理/管理员)
router.get('/overview', async (req, res) => {
  try {
    if (!hasRole(req.user, 'ADMIN', 'MANAGER')) {
      return res.status(403).json({ code: 1003, message: '仅经理/管理员可查看全员进度' })
    }
    const users = await prisma.user.findMany({
      where: { status: 1, deletedAt: null },
      select: { id: true, name: true, username: true, role: true },
      orderBy: { id: 'asc' }
    })
    const stepMap = await computeSteps(users)
    const list = users.map(u => {
      const steps = stepMap.get(String(u.id))
      const doneCount = steps.filter(s => s.done).length
      return {
        userId: u.id, name: u.name, username: u.username, role: u.role,
        steps, doneCount, total: steps.length,
        // 步骤可能跳着完成(老员工有任务但没下过配置包), 「卡在」取第一个未完成步骤
        currentStep: steps.find(s => !s.done)?.title || null
      }
    })
    res.json({ code: 0, data: { list } })
  } catch (e) {
    console.error('[onboarding:overview]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 生成并下载配置包: 签发专属 Key(明文只进 zip 不落库) + .mcp.json/技能/README 打包
// 重复下载 = 吊销旧「开发配置包」Key 重新签发(旧包里的 Key 随之失效, 防泄露后无法收口)
router.post('/package', async (req, res) => {
  try {
    const userId = BigInt(req.user.userId)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } })

    // v1.6 Agent 身份: 配置包对应一个 CLAUDE_CODE Agent, 经此 Key 的写入归属该 Agent 可审计
    let profile = await prisma.agentProfile.findFirst({
      where: { userId, platform: 'CLAUDE_CODE', name: `${user.name} 的开发助手`, deletedAt: null }
    })
    if (!profile) {
      profile = await prisma.agentProfile.create({
        data: { userId, name: `${user.name} 的开发助手`, platform: 'CLAUDE_CODE', description: '开发上手中心自动注册, 用于任务驱动开发工作流' }
      })
    }
    await prisma.apiKey.updateMany({
      where: { userId, name: PKG_KEY_NAME, status: 1 },
      data: { status: 0, revokedAt: new Date() }
    })
    const { raw, hash, prefix } = generateApiKey()
    await prisma.apiKey.create({
      data: { userId, name: PKG_KEY_NAME, keyHash: hash, prefix, scope: 'PERSONAL', agentProfileId: profile.id }
    })

    const mcpJson = JSON.stringify({
      mcpServers: {
        fde: { type: 'http', url: mcpUrl(req), headers: { Authorization: `Bearer ${raw}` } }
      }
    }, null, 2)
    const readme = fs.readFileSync(path.join(TPL_DIR, 'README.md'), 'utf8').replaceAll('{{USER_NAME}}', user.name || user.username)
    const skill = fs.readFileSync(path.join(TPL_DIR, 'SKILL.md'), 'utf8')

    const zip = new JSZip()
    zip.file('README.md', readme)
    zip.file('.mcp.json', mcpJson)
    zip.file('skills/fde-tasks/SKILL.md', skill)
    // v2.0.8(#423): CLAUDE.md 标准模板进包 —— 新项目复制到仓库根目录按占位符填写
    zip.file('CLAUDE-template.md', fs.readFileSync(path.join(TPL_DIR, 'CLAUDE-template.md'), 'utf8'))
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="fde-dev-kit.zip"`)
    res.send(buf)
  } catch (e) {
    console.error('[onboarding:package]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
