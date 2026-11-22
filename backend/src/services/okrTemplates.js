// OKR 7.0: 个人 OKR 模板 —— 常用的周计划 Markdown, 只归本人(看 / 建 / 删都只能是自己的)。
// 模板只是存文字; 用的时候前端把 contentMd 交给 /plan/bulk-import, 解析与校验全在那里。
import prisma from '../lib/prisma.js'
import { OkrRuleError } from './okrRules.js'
import { BULK_MAX_TEXT } from './okrDraft.js'

export const TEMPLATE_NAME_MAX = 100
export const TEMPLATES_PER_USER = 50

const view = t => ({ id: String(t.id), name: t.name, contentMd: t.contentMd, createdAt: t.createdAt })

export async function listTemplates(userId) {
  const rows = await prisma.okrTemplate.findMany({ where: { userId: BigInt(userId) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return rows.map(view)
}

export async function createTemplate(userId, { name, contentMd } = {}) {
  const n = String(name ?? '').trim()
  const md = String(contentMd ?? '')
  if (!n) throw new OkrRuleError('模板要有名字', { code: 8175 })
  if (n.length > TEMPLATE_NAME_MAX) throw new OkrRuleError(`模板名字超过 ${TEMPLATE_NAME_MAX} 字`, { code: 8175 })
  if (!md.trim()) throw new OkrRuleError('模板内容不能为空', { code: 8175 })
  if (md.length > BULK_MAX_TEXT) throw new OkrRuleError(`模板内容超过 ${BULK_MAX_TEXT} 字`, { code: 8175 })
  const count = await prisma.okrTemplate.count({ where: { userId: BigInt(userId) } })
  if (count >= TEMPLATES_PER_USER) throw new OkrRuleError(`每人最多 ${TEMPLATES_PER_USER} 个模板, 先删掉不用的`, { code: 8175 })
  return view(await prisma.okrTemplate.create({ data: { userId: BigInt(userId), name: n, contentMd: md } }))
}

/** 只能删自己的; 别人的和不存在的一样报 404(不暴露别人有没有这个模板) */
export async function deleteTemplate(userId, id) {
  if (!/^\d+$/.test(String(id))) throw new OkrRuleError('模板不存在', { status: 404, code: 8176 })
  const r = await prisma.okrTemplate.deleteMany({ where: { id: BigInt(id), userId: BigInt(userId) } })
  if (!r.count) throw new OkrRuleError('模板不存在', { status: 404, code: 8176 })
  return { id: String(id), deleted: true }
}
