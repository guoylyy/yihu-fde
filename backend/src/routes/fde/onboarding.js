// FDE 平台 - 开发上手中心 (v2.0.0 #367)
// 目标: 新员工照 checklist 从零走到「第一次收工回写」全程不需要口头指导。
// 五步全部实时计算不落表(数据都在既有业务表里, 不引入新状态源):
//   1 配置包          → 下载过开发配置包(users.kit_downloaded_at)
//   2 MCP 连通        → 经以虎 One 调过 MCP(users.mcp_last_used_at), 或任一 Key 用过(老的个人 Key / Agent Key)
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
import { mcpUrl } from '../../lib/settings.js'
import { appInfo } from '../../lib/yihuOne.js'

const router = express.Router()
router.use(internalAuth)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TPL_DIR = path.join(__dirname, '../../templates/onboarding')
const COMMIT_LINK_MARK = '🔗 自动关联提交'   // 与 services/repoSync.js 的评论文案保持一致

const STEP_DEFS = [
  { key: 'package', title: '下载开发配置包', desc: '下载 .mcp.json 模板 + fde-tasks 技能 + 上手教程' },
  { key: 'mcp', title: '打通 MCP 连接', desc: '在以虎 One 个人中心生成 API Key 填进 .mcp.json, 在 Claude Code 里说「开工」, 平台检测到调用即完成' },
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
  const [keys, engineers, marks] = await Promise.all([
    prisma.apiKey.findMany({
      where: { userId: { in: userIds }, scope: 'PERSONAL' },
      select: { userId: true, status: true, lastUsedAt: true }
    }),
    prisma.engineer.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true }
    }),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, kitDownloadedAt: true, mcpLastUsedAt: true }
    })
  ])
  const markByUser = new Map(marks.map(m => [String(m.id), m]))
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

    const mark = markByUser.get(uid) || {}
    const kitDownloaded = !!mark.kitDownloadedAt || myKeys.some(k => k.status === 1)
    const mcpUsed = !!mark.mcpLastUsedAt || myKeys.some(k => k.lastUsedAt)
    const started = myTasks.some(t => t.startedAt || ['IN_PROGRESS', 'DONE', 'VERIFIED'].includes(t.status))
    const commitLinked = myTasks.some(t => myTaskComments(t).some(c => c.content.includes(COMMIT_LINK_MARK)))
    const doneWritten = myTasks.some(t =>
      ['DONE', 'VERIFIED'].includes(t.status) &&
      myTaskComments(t).some(c => String(c.authorId) === uid && !c.content.includes(COMMIT_LINK_MARK))
    )

    const doneFlags = [kitDownloaded, mcpUsed, started, commitLinked, doneWritten]
    result.set(uid, STEP_DEFS.map((s, i) => ({ ...s, done: doneFlags[i] })))
  }
  return result
}

// 我的上手进度
router.get('/steps', async (req, res) => {
  try {
    const userId = BigInt(req.user.userId)
    const steps = (await computeSteps([{ id: userId }])).get(String(userId))
    // 个人 AI 工具经以虎 One 的 MCP 网关接入; 没接平台(本地开发)时给本系统自己的地址
    const platformUrl = String((await appInfo())?.platformUrl || '').replace(/\/+$/, '')
    res.json({ code: 0, data: {
      steps, doneCount: steps.filter(s => s.done).length, total: steps.length,
      mcpUrl: platformUrl ? `${platformUrl}/api/mcp` : mcpUrl(req), platformUrl: platformUrl || null
    } })
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

// 下载配置包: .mcp.json(连以虎 One 的 MCP 网关, 密钥由本人在以虎 One 个人中心生成后填入) + 技能 + 上手教程
// 包里不含任何密钥, 本系统也不再签发个人 Key: 一个以虎 One API Key 通用于平台上所有应用的工具
router.post('/package', async (req, res) => {
  try {
    const userId = BigInt(req.user.userId)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } })
    const app = await appInfo()
    const platformUrl = String(app?.platformUrl || '').replace(/\/+$/, '')
    // 没接平台(本地开发)时退回本系统自己的 MCP 地址, 用 Agent 专属 Key
    const gateway = platformUrl ? `${platformUrl}/api/mcp` : mcpUrl(req)
    const appCode = app?.code || 'fde'

    const mcpJson = JSON.stringify({
      mcpServers: {
        'yihu-one': { type: 'http', url: gateway, headers: { Authorization: 'Bearer <在以虎 One 个人中心生成的 API Key>' } }
      }
    }, null, 2)
    const fill = (t) => t
      .replaceAll('{{USER_NAME}}', user.name || user.username)
      .replaceAll('{{PLATFORM_URL}}', platformUrl || '<以虎 One 地址>')
      .replaceAll('{{MCP_URL}}', gateway)
      .replaceAll('{{APP_CODE}}', appCode)
    const zip = new JSZip()
    zip.file('README.md', fill(fs.readFileSync(path.join(TPL_DIR, 'README.md'), 'utf8')))
    zip.file('.mcp.json', mcpJson)
    zip.file('skills/fde-tasks/SKILL.md', fill(fs.readFileSync(path.join(TPL_DIR, 'SKILL.md'), 'utf8')))
    // v2.0.8(#423): CLAUDE.md 标准模板进包 —— 新项目复制到仓库根目录按占位符填写
    zip.file('CLAUDE-template.md', fs.readFileSync(path.join(TPL_DIR, 'CLAUDE-template.md'), 'utf8'))
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    await prisma.user.update({ where: { id: userId }, data: { kitDownloadedAt: new Date() } })

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="fde-dev-kit.zip"`)
    res.send(buf)
  } catch (e) {
    console.error('[onboarding:package]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
