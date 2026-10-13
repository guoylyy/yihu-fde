// v2.5.0(#804): 从已有工程师、项目、工时、任务和验收数据生成只读能力画像
import express from 'express'
import { z } from 'zod'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { engineerAcceptanceMetrics } from '../../services/engineerAcceptanceMetrics.js'
import { rankEngineerProfiles } from '../../services/engineerMatching.js'
import { ENGINEER_ROLES } from '../../lib/engineerRoles.js'
import { deriveIndependence } from '../../services/engineerIndependence.js'

const router = express.Router()
router.use(internalAuth, requirePermission('engineer.access'), requirePermission('engineer.view'))

const limit = (max, fallback) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max)).default(fallback)
const listQuery = z.object({ limit: limit(200, 100) }).strict()
const matchQuery = z.object({
  limit: limit(50, 10),
  projectType: z.string().trim().min(1).max(50).optional(),
  role: z.string().trim().min(1).max(50).optional(),
  skill: z.string().trim().min(1).max(100).optional()
}).strict()
const engineerId = z.string().refine(id => /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n)
const eligibleWhere = () => ({ deletedAt: null, user: { deletedAt: null, status: 1, role: { in: ENGINEER_ROLES } } })

function round(n) { return Math.round(n * 10) / 10 }
function level(score) { return score >= 80 ? 'EXPERT' : score >= 60 ? 'SENIOR' : score >= 35 ? 'MIDDLE' : 'JUNIOR' }

async function buildProfile(engineer) {
  const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth() - 2, 1)
  const [members, timesheets, tasks] = await Promise.all([
    prisma.projectMember.findMany({ where: { engineerId: engineer.id, leaveDate: null }, select: { project: { select: { id: true, type: true, status: true, name: true } }, roleInProject: true } }),
    prisma.timesheet.findMany({ where: { engineerId: engineer.id, deletedAt: null, workDate: { gte: from } }, select: { hours: true, status: true } }),
    prisma.task.findMany({ where: { assigneeId: engineer.id, deletedAt: null }, select: { id: true, status: true, project: { select: { type: true } } } })
  ])
  const taskIds = tasks.map(t => t.id)
  const records = taskIds.length ? await prisma.acceptanceRecord.findMany({ where: { taskId: { in: taskIds }, shadow: false, createdAt: { lte: now } }, select: { id: true, taskId: true, conclusion: true, createdAt: true, shadow: true } }) : []
  const acceptance = engineerAcceptanceMetrics(records, from, now)
  const quality = acceptance.firstPassRate
  const approved = timesheets.filter(t => t.status === 'APPROVED').reduce((s, t) => s + Number(t.hours), 0)
  const planned = 22 * 3 * 8
  const capacity = Math.min(100, approved / planned * 100)
  const delivery = tasks.length ? tasks.filter(t => ['DONE', 'VERIFIED'].includes(t.status)).length / tasks.length * 100 : null
  const dimensions = { quality: quality == null ? null : round(quality), capacity: round(capacity), delivery: delivery == null ? null : round(delivery) }
  const known = Object.values(dimensions).filter(v => v != null)
  const score = known.length ? round(known.reduce((a, b) => a + b, 0) / known.length) : 0
  return { engineerId: String(engineer.id), userId: String(engineer.userId), name: engineer.user.name, level: level(score), score, available: engineer.available === 1, dimensions, skills: engineer.skills || [], projectTypes: [...new Set(members.map(m => m.project.type).filter(Boolean))], roles: [...new Set(members.map(m => m.roleInProject))], projects: members.length, activeProjects: members.filter(m => m.project.status === 'IN_PROGRESS').length, approvedHours3m: round(approved), tasks: tasks.length, acceptance, independence: deriveIndependence({ delivery, firstPassRate: quality, approvedHours3m: approved, tasks: tasks.length }) }
}

async function listProfiles(limit = 200) {
  const engineers = await prisma.engineer.findMany({ where: eligibleWhere(), include: { user: { select: { id: true, name: true, role: true } } }, take: limit, orderBy: { id: 'asc' } })
  return Promise.all(engineers.map(buildProfile))
}

router.get('/', async (req, res) => {
  const query = listQuery.safeParse(req.query)
  if (!query.success) return res.status(400).json({ code: 400, message: 'limit 必须为1至200的整数' })
  try {
    const profiles = await listProfiles(query.data.limit)
    res.json({ code: 0, data: { generatedAt: new Date().toISOString(), list: profiles, total: profiles.length } })
  } catch (e) { console.error('[engineer-profiles:list]', e.name); res.status(500).json({ code: 9001, message: '画像读取失败，请稍后重试' }) }
})

router.get('/suggest', async (req, res) => {
  const query = matchQuery.safeParse(req.query)
  if (!query.success) return res.status(400).json({ code: 400, message: '推荐参数无效，limit 须为1至50的整数，匹配条件须为单个短文本' })
  try {
    const profiles = await listProfiles(200)
    const list = rankEngineerProfiles(profiles, query.data).slice(0, query.data.limit)
    res.json({ code: 0, data: { list, total: list.length } })
  } catch (e) { console.error('[engineer-profiles:suggest]', e.name); res.status(500).json({ code: 9001, message: '推荐读取失败，请稍后重试' }) }
})

router.get('/:engineerId', async (req, res) => {
  if (!engineerId.safeParse(req.params.engineerId).success) return res.status(400).json({ code: 400, message: '工程师ID无效' })
  try {
    const id = BigInt(req.params.engineerId)
    const engineer = await prisma.engineer.findFirst({ where: { id, ...eligibleWhere() }, include: { user: { select: { id: true, name: true, role: true } } } })
    if (!engineer) return res.status(404).json({ code: 404, message: '工程师不存在' })
    res.json({ code: 0, data: await buildProfile(engineer) })
  } catch (e) { console.error('[engineer-profiles:detail]', e.name); res.status(500).json({ code: 9001, message: '画像读取失败，请稍后重试' }) }
})

export default router
