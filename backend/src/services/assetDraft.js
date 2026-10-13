// v2.7 项目资产库 (#1140) —— 项目收尾时起草资产草稿
//
// 沉淀从「创作」降级为「审核」: 经理不用从零写, 只判断留不留。
// 素材 = 项目已完成任务标题 + 收工回写 + 代码仓库。配了大模型 → AI 起草最多 3 个候选;
// 没配或调用失败 → 生成一条 L0 骨架草稿(列出完成的任务, 提示经理挑出可复用的部分), 流程不中断。
// 硬约束: 一律 DRAFT + RESTRICTED + aiGenerated, 发布必须人工审核并过脱敏扫描。
import prisma from '../lib/prisma.js'
import { chatComplete, getActiveLlmConfig } from '../lib/llm.js'
import { ASSET_LAYERS } from './assets.js'

const SYSTEM_PROMPT = `你在帮一家软件交付公司把一个已完成项目里「可以被其他客户直接复用」的能力单元识别出来，登记到资产库。

资产的判定标准只有一条：另一个项目可以直接拿走用，并且省下的工时 ≥ 1 人天。
分三层：FRAMEWORK（项目骨架/模板/部署）、ARCH（与业务无关的技术能力，如登录、支付、消息、AI 接入）、BIZ（可跨客户复用的业务功能块）。

不要登记：只对这个客户成立的逻辑；平台自带能力；纯 CRUD；一次性脚本。
没有值得登记的就返回空数组 []。最多返回 3 个。

输出严格 JSON 数组，每项：
{"slug":"kebab-case 英文","name":"中文名","summary":"一句话：解决什么问题","layer":"FRAMEWORK|ARCH|BIZ",
 "keywords":["触发词，含同义词"],"techStack":["vue3", "..."],"estSavedDays":数字,
 "readme":"Markdown：## 解决什么问题 / ## 适用与不适用 / ## 关键实现 / ## 接入步骤 / ## 坑"}

硬要求：客户名称、域名、IP、密钥、人名、手机号一律换成占位符（如 <客户>、<域名>）；不知道的内容不要编。`

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset'
}

async function uniqueSlug(base) {
  let slug = slugify(base)
  for (let i = 2; await prisma.asset.findUnique({ where: { slug } }); i++) slug = `${slugify(base)}-${i}`.slice(0, 80)
  return slug
}

async function collectMaterial(project) {
  const [tasks, repos] = await Promise.all([
    prisma.task.findMany({
      where: { projectId: project.id, deletedAt: null, status: { in: ['DONE', 'VERIFIED'] } },
      select: { id: true, title: true }, orderBy: { completedAt: 'desc' }, take: 60
    }),
    prisma.projectRepository.findMany({ where: { projectId: project.id, deletedAt: null }, select: { name: true, url: true } })
  ])
  const comments = tasks.length ? await prisma.comment.findMany({
    where: { entity: 'task', entityId: { in: tasks.map(t => t.id) }, deletedAt: null },
    select: { entityId: true, content: true }, orderBy: { createdAt: 'desc' }, take: 40
  }) : []
  return { tasks, repos, comments }
}

function parseJsonArray(text) {
  const m = /\[[\s\S]*\]/.exec(String(text || ''))
  if (!m) return null
  try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : null } catch { return null }
}

/**
 * @returns {{created: object[], mode: 'AI'|'SKELETON', reason?: string}}
 */
export async function draftAssetFromProject(project, { userId, hint } = {}) {
  const { tasks, repos, comments } = await collectMaterial(project)
  const base = {
    status: 'DRAFT', maturity: 'L0', authorization: 'RESTRICTED', aiGenerated: true,
    sourceProjectId: project.id,
    sourceRepo: repos[0]?.url || null,
    ownerId: userId ? BigInt(userId) : null,
    createdBy: userId ? BigInt(userId) : null, updatedBy: userId ? BigInt(userId) : null
  }

  let cfg = null
  try { cfg = await getActiveLlmConfig() } catch { cfg = null }
  let reason
  if (cfg && tasks.length) {
    try {
      const material = [
        `项目：${project.name}`,
        project.description ? `项目说明：${String(project.description).slice(0, 1500)}` : '',
        repos.length ? `代码仓库：${repos.map(r => r.name).join('、')}` : '',
        hint ? `经理提示：${String(hint).slice(0, 500)}` : '',
        `已完成任务：\n${tasks.map(t => `- ${t.title}`).join('\n')}`,
        comments.length ? `收工回写摘录：\n${comments.map(c => `- ${String(c.content).slice(0, 300)}`).join('\n')}` : ''
      ].filter(Boolean).join('\n\n')
      const out = await chatComplete({ system: SYSTEM_PROMPT, user: material, maxTokens: 4000, config: cfg })
      const items = parseJsonArray(out)
      if (items) {
        const created = []
        for (const it of items.slice(0, 3)) {
          if (!it || !it.name || !ASSET_LAYERS.includes(it.layer)) continue
          const est = Number(it.estSavedDays)
          created.push(await prisma.asset.create({
            data: {
              ...base,
              slug: await uniqueSlug(it.slug || it.name),
              name: String(it.name).slice(0, 100),
              summary: String(it.summary || it.name).slice(0, 300),
              layer: it.layer,
              keywords: Array.isArray(it.keywords) ? it.keywords.map(String).slice(0, 30) : [],
              techStack: Array.isArray(it.techStack) ? it.techStack.map(String).slice(0, 20) : [],
              estSavedDays: Number.isFinite(est) && est >= 0 && est < 999 ? est : null,
              readme: it.readme ? String(it.readme) : null
            }
          }))
        }
        return { created, mode: 'AI', reason: created.length ? undefined : 'AI 判断本项目没有值得登记的通用能力' }
      }
      reason = 'AI 返回格式无法解析，已改为生成骨架草稿'
    } catch (e) {
      reason = `AI 起草失败（${String(e.message).slice(0, 100)}），已改为生成骨架草稿`
    }
  } else {
    reason = !tasks.length ? '项目还没有已完成的任务，生成骨架草稿' : '未配置大模型，生成骨架草稿'
  }

  // 骨架: 让经理在完成任务清单里圈出可复用的部分, 再补方案
  const readme = [
    `> 自动生成的骨架草稿（${reason}）。请从下面的完成任务里挑出能被其他项目复用的部分，改写标题与方案；不值得沉淀就直接删除本草稿。`,
    '',
    '## 解决什么问题', '', '（待补充）', '',
    '## 候选素材：本项目已完成的任务', '',
    ...(tasks.length ? tasks.slice(0, 30).map(t => `- ${t.title}（任务 #${t.id}）`) : ['（暂无）']),
    '', '## 接入步骤', '', '（待补充）', '', '## 坑', '', '（待补充）'
  ].join('\n')
  const created = [await prisma.asset.create({
    data: {
      ...base,
      slug: await uniqueSlug(`${project.code || 'project'}-candidate`),
      name: `${project.name}·可沉淀能力（待整理）`.slice(0, 100),
      summary: '项目收尾自动生成的候选草稿，待经理挑选可复用部分',
      layer: 'BIZ',
      keywords: [],
      readme
    }
  })]
  return { created, mode: 'SKELETON', reason }
}
