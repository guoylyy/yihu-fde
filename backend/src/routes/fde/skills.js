// FDE 平台 - 技能主数据 + 工程师技能关联 API
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requireRole, requirePermission } from '../../lib/auth.js'
import { recordActivity } from '../../lib/activity.js'

const router = express.Router()
router.use(internalAuth)
router.use(requirePermission('skill.access'))

const SKILL_CATEGORIES = ['FRONTEND', 'BACKEND', 'MOBILE', 'DEVOPS', 'DATA', 'PM', 'DESIGN', 'OTHER']

/**
 * GET /api/fde/skills
 * 列出所有技能（可按 category 筛选，模糊搜 name）
 */
router.get('/', async (req, res) => {
  try {
    const { category = '', keyword = '' } = req.query
    const where = { deletedAt: null }
    if (category) where.category = category
    if (keyword) where.name = { contains: keyword }

    const list = await prisma.skill.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { engineers: true } } }
    })
    res.json({ code: 0, message: 'ok', data: { list, categories: SKILL_CATEGORIES } })
  } catch (e) {
    console.error('[fde/skills GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/skills
 * 新建技能（ADMIN/MANAGER）
 */
router.post('/', requirePermission('skill.manage'), async (req, res) => {
  try {
    const { name, category, description } = req.body
    if (!name || !category) return res.status(400).json({ code: 1001, message: '名称和分类必填' })
    if (!SKILL_CATEGORIES.includes(category)) {
      return res.status(400).json({ code: 1002, message: `分类必须是 ${SKILL_CATEGORIES.join(' / ')}` })
    }
    const exist = await prisma.skill.findFirst({ where: { name, deletedAt: null } })
    if (exist) return res.status(400).json({ code: 1003, message: '技能已存在' })
    const skill = await prisma.skill.create({ data: { name, category, description } })
    // 活动流
    await recordActivity({
      actorId: req.user.id,
      entity: 'skill',
      entityId: skill.id,
      action: 'created',
      summary: `新增技能「${skill.name}」（${skill.category}）`,
      data: { category: skill.category }
    })
    res.json({ code: 0, message: 'ok', data: skill })
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ code: 1003, message: '技能已存在' })
    console.error('[fde/skills POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/skills/:id
 * 改技能名/分类/描述
 */
router.put('/:id', requirePermission('skill.manage'), async (req, res) => {
  try {
    const { name, category, description } = req.body
    if (category && !SKILL_CATEGORIES.includes(category)) {
      return res.status(400).json({ code: 1002, message: `分类必须是 ${SKILL_CATEGORIES.join(' / ')}` })
    }
    const old = await prisma.skill.findUnique({ where: { id: BigInt(req.params.id) } })
    const skill = await prisma.skill.update({
      where: { id: BigInt(req.params.id) },
      data: { name, category, description }
    })
    if (old) {
      const changes = []
      if (old.name !== skill.name) changes.push(`名称「${old.name}」→「${skill.name}」`)
      if (old.category !== skill.category) changes.push(`分类 ${old.category}→${skill.category}`)
      if (changes.length) {
        await recordActivity({
          actorId: req.user.id,
          entity: 'skill',
          entityId: skill.id,
          action: 'updated',
          summary: `更新技能：${changes.join('，')}`,
          data: { changes: changes.join(';') }
        })
      }
    }
    res.json({ code: 0, message: 'ok', data: skill })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '技能不存在' })
    console.error('[fde/skills PUT /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/skills/:id
 * 软删除（如果有工程师绑定，禁止删）
 */
router.delete('/:id', requirePermission('skill.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const used = await prisma.engineerSkill.count({ where: { skillId: id } })
    if (used > 0) {
      return res.status(400).json({ code: 1004, message: `该技能已被 ${used} 个工程师使用，请先解除关联` })
    }
    await prisma.skill.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    console.error('[fde/skills DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/engineers/:id/skills
 * 查某工程师的技能（含 level/yearsExp）
 */
router.get('/engineer/:engineerId', async (req, res) => {
  try {
    const list = await prisma.engineerSkill.findMany({
      where: { engineerId: BigInt(req.params.engineerId) },
      include: { skill: true },
      orderBy: { level: 'desc' }
    })
    res.json({
      code: 0, message: 'ok',
      data: list.map(es => ({
        id: es.id,
        skillId: es.skillId,
        skillName: es.skill.name,
        category: es.skill.category,
        level: es.level,
        yearsExp: es.yearsExp
      }))
    })
  } catch (e) {
    console.error('[fde/skills GET /engineer/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/engineers/:id/skills
 * 批量设置某工程师的技能（全替换）
 * body: { items: [{ skillId, level, yearsExp }] }
 */
router.put('/engineer/:engineerId', requirePermission('engineer.edit'), async (req, res) => {
  try {
    const engineerId = BigInt(req.params.engineerId)
    const items = Array.isArray(req.body.items) ? req.body.items : []

    // 验证所有 skillId 存在
    const skillIds = items.map(i => BigInt(i.skillId))
    if (skillIds.length) {
      const existSkills = await prisma.skill.findMany({
        where: { id: { in: skillIds }, deletedAt: null },
        select: { id: true }
      })
      if (existSkills.length !== new Set(skillIds.map(String)).size) {
        return res.status(400).json({ code: 1005, message: '部分技能不存在' })
      }
    }

    await prisma.$transaction([
      prisma.engineerSkill.deleteMany({ where: { engineerId } }),
      ...(items.length ? [prisma.engineerSkill.createMany({
        data: items.map(i => ({
          engineerId,
          skillId: BigInt(i.skillId),
          level: i.level || 3,
          yearsExp: i.yearsExp || null
        }))
      })] : [])
    ])

    // 同步冗余 skills JSON
    const skills = await prisma.skill.findMany({
      where: { id: { in: skillIds } },
      select: { name: true }
    })
    await prisma.engineer.update({
      where: { id: engineerId },
      data: { skills: skills.map(s => s.name) }
    })
    // 活动流
    const eng = await prisma.engineer.findUnique({
      where: { id: engineerId },
      include: { user: { select: { name: true } } }
    })
    await recordActivity({
      actorId: req.user.id,
      entity: 'engineer',
      entityId: engineerId,
      action: 'updated',
      summary: `更新了「${eng?.user?.name || '工程师'}」的技能（${skills.length} 项）`,
      data: { count: skills.length, names: skills.map(s => s.name) }
    })

    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    console.error('[fde/skills PUT /engineer/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/engineers/match?skills=A,B,C
 * 按技能推荐工程师（匹配度 + 可派工 + 职级）
 */
router.get('/match', async (req, res) => {
  try {
    const { skills = '' } = req.query
    const skillNames = skills.split(',').map(s => s.trim()).filter(Boolean)
    if (!skillNames.length) return res.json({ code: 0, message: 'ok', data: [] })

    // 找到这些技能的 engineerId + 命中数
    const matched = await prisma.engineerSkill.findMany({
      where: {
        skill: { name: { in: skillNames }, deletedAt: null },
        engineer: { available: 1, deletedAt: null }
      },
      include: {
        engineer: { include: { user: { select: { id: true, name: true, username: true, status: true } } } },
        skill: { select: { name: true } }
      }
    })

    // 聚合
    const byEng = new Map()
    for (const es of matched) {
      const eid = es.engineerId.toString()
      if (!byEng.has(eid)) {
        byEng.set(eid, { engineer: es.engineer, matchedSkills: [], matchScore: 0 })
      }
      const item = byEng.get(eid)
      item.matchedSkills.push(es.skill.name)
      item.matchScore += es.level  // 加权：技能 level
    }
    const result = [...byEng.values()]
      .sort((a, b) => b.matchScore - a.matchScore)
      .map(r => ({
        id: r.engineer.id,
        userId: r.engineer.userId,
        name: r.engineer.user.name,
        username: r.engineer.user.username,
        level: r.engineer.level,
        city: r.engineer.city,
        dailyRate: r.engineer.dailyRate,
        matchedSkills: r.matchedSkills,
        matchScore: r.matchScore,
        matchCount: r.matchedSkills.length
      }))
    res.json({ code: 0, message: 'ok', data: result })
  } catch (e) {
    console.error('[fde/skills/match]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router