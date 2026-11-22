// OKR 4.0: 项目周 OKR 文档。老板要的是「每周每个项目的基本 OKR 全员可见, 有方便的地方查看」,
// 所以只存一份 Markdown 文档(手写保存或上传 .md/.txt/.docx 抽正文), 不拆成结构化的 O/KR。
//
// 一周一项目一份(唯一键 projectId+year+weekNo), 重复保存覆盖同一份, 记最近一次的 updatedBy。
// 读: 登录即可。写: ADMIN / MANAGER / 该项目成员(project_members 在册, 或项目经理 managerId)。
import prisma from '../lib/prisma.js'
import { OkrRuleError, weekKey } from './okrRules.js'

export const TITLE_MAX = 200
export const SOURCE_FILE_MAX = 255
// 手写保存走全局 express.json(100kb); 上传文件 ≤ 2MB, 列是 MEDIUMTEXT(16MB), 这里再兜一道
export const CONTENT_MAX_CHARS = 2 * 1024 * 1024

const WRITER_ROLES = new Set(['ADMIN', 'MANAGER'])
// 已关闭 / 已取消的项目不进周列表(那一周已经有文档的除外)
const INACTIVE = ['CLOSED', 'CANCELLED']

const notFound = msg => new OkrRuleError(msg, { status: 404, code: 8150 })
const bad = msg => new OkrRuleError(msg, { status: 400, code: 8151 })

async function loadUsers(ids) {
  const uniq = [...new Set(ids.filter(v => v != null).map(String))]
  if (!uniq.length) return new Map()
  const rows = await prisma.user.findMany({ where: { id: { in: uniq.map(BigInt) } }, select: { id: true, name: true, username: true } })
  return new Map(rows.map(u => [String(u.id), { id: String(u.id), name: u.name, username: u.username }]))
}

const userOf = (users, id) => (id == null ? null : users.get(String(id)) || { id: String(id) })

export async function loadProject(projectId) {
  if (!/^\d+$/.test(String(projectId ?? ''))) throw notFound('项目不存在')
  const p = await prisma.project.findFirst({
    where: { id: BigInt(projectId), deletedAt: null },
    select: { id: true, code: true, name: true, status: true, managerId: true }
  })
  if (!p) throw notFound('项目不存在')
  return p
}

/** 能否写这个项目的周 OKR 文档: ADMIN / MANAGER / 项目经理 / 项目成员(含老数据只挂 engineerId 的) */
export async function canWriteProjectDoc(user, project) {
  if (WRITER_ROLES.has(user?.role)) return true
  const me = BigInt(user?.id ?? user?.userId)
  if (project.managerId != null && project.managerId === me) return true
  const m = await prisma.projectMember.findFirst({
    where: { projectId: project.id, OR: [{ userId: me }, { engineer: { userId: me } }] },
    select: { id: true }
  })
  return !!m
}

function docView(d, users) {
  return {
    id: String(d.id),
    projectId: String(d.projectId),
    week: weekKey(d),
    title: d.title,
    contentMd: d.contentMd,
    sourceFile: d.sourceFile,
    createdBy: userOf(users, d.createdBy),
    updatedBy: userOf(users, d.updatedBy),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  }
}

const projectView = p => ({ id: String(p.id), code: p.code, name: p.name, status: p.status })

/** 某周全部项目: 有文档的 + 没文档但在进行的(hasDoc=false)。有文档的排前面, 其余按项目名 */
export async function listProjectDocs(week) {
  const docs = await prisma.okrProjectDoc.findMany({
    where: { year: week.year, weekNo: week.weekNo },
    select: { id: true, projectId: true, year: true, weekNo: true, title: true, sourceFile: true, updatedBy: true, updatedAt: true }
  })
  const docIds = docs.map(d => d.projectId)
  const projects = await prisma.project.findMany({
    where: { deletedAt: null, OR: [{ status: { notIn: INACTIVE } }, ...(docIds.length ? [{ id: { in: docIds } }] : [])] },
    select: { id: true, code: true, name: true, status: true }
  })
  const byProject = new Map(docs.map(d => [String(d.projectId), d]))
  const users = await loadUsers(docs.map(d => d.updatedBy))
  const rows = projects.map(p => {
    const d = byProject.get(String(p.id))
    return {
      project: projectView(p),
      hasDoc: !!d,
      docId: d ? String(d.id) : null,
      title: d?.title ?? null,
      sourceFile: d?.sourceFile ?? null,
      updatedAt: d?.updatedAt ?? null,
      updatedBy: d ? userOf(users, d.updatedBy) : null
    }
  })
  rows.sort((a, b) => Number(b.hasDoc) - Number(a.hasDoc) || String(a.project.name).localeCompare(String(b.project.name), 'zh'))
  return { week: weekKey(week), total: rows.length, withDoc: docs.length, rows }
}

/** 单份文档全文; 这周还没有 → doc=null(项目不存在才 404) */
export async function getProjectDoc(projectId, week) {
  const project = await loadProject(projectId)
  const d = await prisma.okrProjectDoc.findUnique({
    where: { projectId_year_weekNo: { projectId: project.id, year: week.year, weekNo: week.weekNo } }
  })
  const users = d ? await loadUsers([d.createdBy, d.updatedBy]) : new Map()
  return { week: weekKey(week), project: projectView(project), hasDoc: !!d, doc: d ? docView(d, users) : null }
}

/** 从 Markdown 第一行标题取 title(# xxx), 取不到用兜底 */
function titleFrom(contentMd, fallback) {
  const m = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/m.exec(contentMd)
  return (m?.[1] || fallback).slice(0, TITLE_MAX)
}

/**
 * upsert: 一周一项目一份, 重复保存覆盖同一份。title 不给就从正文第一个标题 / 「项目名 周 OKR」兜底。
 * sourceFile: 上传导入时传文件名; 手写保存传 null(内容已不是那份文件了)
 * 返回 { doc, created }
 */
export async function saveProjectDoc({ project, week, title, contentMd, sourceFile = null, by }) {
  const content = typeof contentMd === 'string' ? contentMd.replace(/^﻿/, '').replace(/\r\n?/g, '\n') : ''
  if (!content.trim()) throw bad('contentMd 不能为空(只支持 Markdown 文本)')
  if (content.length > CONTENT_MAX_CHARS) throw bad('正文太长(上限 2MB)')
  if (title != null && typeof title !== 'string') throw bad('title 要是字符串')
  const t = String(title ?? '').trim()
  if (t.length > TITLE_MAX) throw bad(`title 最多 ${TITLE_MAX} 字`)
  const finalTitle = t || titleFrom(content, `${project.name} ${weekKey(week)} OKR`)
  const file = sourceFile ? String(sourceFile).slice(0, SOURCE_FILE_MAX) : null
  const key = { projectId_year_weekNo: { projectId: project.id, year: week.year, weekNo: week.weekNo } }
  const before = await prisma.okrProjectDoc.findUnique({ where: key, select: { id: true } })
  const d = await prisma.okrProjectDoc.upsert({
    where: key,
    update: { title: finalTitle, contentMd: content, sourceFile: file, updatedBy: BigInt(by) },
    create: { projectId: project.id, year: week.year, weekNo: week.weekNo, title: finalTitle, contentMd: content, sourceFile: file, createdBy: BigInt(by), updatedBy: BigInt(by) }
  })
  const users = await loadUsers([d.createdBy, d.updatedBy])
  return { doc: docView(d, users), created: !before }
}
