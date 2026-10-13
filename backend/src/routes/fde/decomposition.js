import express from 'express'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { validateDecompositionDraft, generateDecompositionDraft, buildProjectContext, applyDecompositionDraft, suggestDependencies, explainRoadmap } from '../../services/decompositionDraft.js'
import { LlmNotConfiguredError } from '../../lib/llm.js'
import { isProjectInScope } from './projects.js'
const router = express.Router()
router.use(internalAuth, requirePermission('project.access'))

function fail(res, e) {
  if (e instanceof LlmNotConfiguredError) return res.status(503).json({ code: 503, message: '尚未配置可用的大模型' })
  if (e.code === 2004) return res.status(404).json({ code: 2004, message: e.message })
  if (e.code === 9006) return res.status(400).json({ code: 9006, message: e.message, cyclePath: e.cyclePath })
  res.status(400).json({ code: 400, message: e.message })
}
async function scoped(req, res) {
  const { projectId } = req.body || {}
  if (!projectId) { res.status(400).json({ code: 9002, message: 'projectId 必填' }); return false }
  if (!(await isProjectInScope(req.user, BigInt(projectId)))) { res.status(404).json({ code: 2004, message: '项目不存在' }); return false }
  return true
}

router.post('/validate', (req, res) => {
  try { res.json({ code: 0, data: validateDecompositionDraft(req.body) }) }
  catch (e) { res.status(400).json({ code: 400, message: e.message }) }
})

// v2.8.0(#1145): 可带 projectId / milestoneId, 生成时附上项目已有里程碑与任务作为上下文(不重复拆, 可接已有路径)
router.post('/generate', async (req, res) => {
  try {
    const { requirement, projectId, milestoneId } = req.body || {}
    if (projectId && !(await isProjectInScope(req.user, BigInt(projectId)))) return res.status(404).json({ code: 2004, message: '项目不存在' })
    const ctx = await buildProjectContext(projectId, milestoneId)
    const data = await generateDecompositionDraft(requirement, { context: ctx.text })
    res.json({ code: 0, data: { ...data, targetMilestone: ctx.targetMilestone ? { id: String(ctx.targetMilestone.id), name: ctx.targetMilestone.name } : null } })
  } catch (e) { fail(res, e) }
})

// v2.8.0(#1145): 草案落库(事务): 建里程碑(可选)/任务(source=AI)/依赖边 + 项目记录留痕
router.post('/apply', requirePermission('task.create'), async (req, res) => {
  try {
    if (!(await scoped(req, res))) return
    const { projectId, milestoneId, draft } = req.body
    if (!draft) return res.status(400).json({ code: 9002, message: 'draft 必填' })
    const data = await applyDecompositionDraft({ projectId, milestoneId: milestoneId || null, draft, userId: req.user.id, agentProfileId: req.user.agentProfileId || null })
    res.json({ code: 0, data })
  } catch (e) { fail(res, e) }
})

// v2.8.0(#1145): 对已有任务提议缺失的依赖(只建议不落库; 已过存在性/重复/成环过滤)
router.post('/suggest-dependencies', requirePermission('task.edit'), async (req, res) => {
  try {
    if (!(await scoped(req, res))) return
    res.json({ code: 0, data: await suggestDependencies({ projectId: req.body.projectId, milestoneId: req.body.milestoneId || undefined }) })
  } catch (e) { fail(res, e) }
})

// v2.8.0(#1145): 用大白话解释当前路径: 能开工的 / 瓶颈 / 离终点还差几步
router.post('/explain', async (req, res) => {
  try {
    if (!(await scoped(req, res))) return
    res.json({ code: 0, data: await explainRoadmap({ projectId: req.body.projectId, milestoneId: req.body.milestoneId || undefined }) })
  } catch (e) { fail(res, e) }
})

export default router
