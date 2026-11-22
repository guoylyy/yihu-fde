// 精简第一轮: 本周项目整体计划(取代「一项目一份项目 OKR」)。
// 团队小, 只要每周一份整体的项目计划(Markdown), 放在周 OKR 里大家一起看。
//
// 一周一份(唯一键 year+weekNo), 重复保存覆盖同一份, 记最近一次的 updatedById。
// 读: 登录即可。写: ADMIN / MANAGER。
// 已结束的周只读: 这一周已过去(weekRange.end < 现在), 且已归档(周期 CLOSED)或已有主管评分。
// 过去但还没归档 / 没评分的周(如周一还在复盘的上周)仍可改。
import prisma from '../lib/prisma.js'
import { OkrRuleError, weekKey, isPastWeek } from './okrRules.js'

export const TITLE_MAX = 200
// 列是 TEXT(64KB, 按字节算)
export const CONTENT_MAX_BYTES = 65535
export const WRITER_ROLES = new Set(['ADMIN', 'MANAGER'])

const bad = (msg, code = 8196) => new OkrRuleError(msg, { status: 400, code })

export const canWriteWeekPlan = user => WRITER_ROLES.has(user?.role)

/** 这一周是否已结束(只读) */
export async function isWeekPlanLocked(week, now = new Date()) {
  if (!isPastWeek(week, now)) return false
  const cycle = await prisma.okrCycle.findUnique({
    where: { year_weekNo: { year: week.year, weekNo: week.weekNo } },
    select: { id: true, status: true }
  })
  if (!cycle) return false
  if (cycle.status === 'CLOSED') return true
  const scored = await prisma.okrScore.findFirst({ where: { cycleId: cycle.id, role: 'MANAGER' }, select: { id: true } })
  return !!scored
}

async function view(week, p, user) {
  const editable = canWriteWeekPlan(user) && !(await isWeekPlanLocked(week))
  if (!p) return { week: weekKey(week), title: null, contentMd: null, updatedAt: null, updatedByName: null, editable }
  const u = await prisma.user.findUnique({ where: { id: p.updatedById }, select: { name: true, username: true } })
  return {
    week: weekKey(week),
    title: p.title,
    contentMd: p.contentMd,
    updatedAt: p.updatedAt,
    updatedById: String(p.updatedById),
    updatedByName: u ? (u.name || u.username) : null,
    editable
  }
}

const keyOf = week => ({ year_weekNo: { year: week.year, weekNo: week.weekNo } })

export async function getWeekPlan(week, user) {
  return view(week, await prisma.okrWeekPlan.findUnique({ where: keyOf(week) }), user)
}

/** upsert(同一周只有一份)。返回 { plan, created } */
export async function saveWeekPlan({ week, title, contentMd, user }) {
  if (!canWriteWeekPlan(user)) throw new OkrRuleError('只有管理员或经理能编辑本周项目计划', { status: 403, code: 8195 })
  if (await isWeekPlanLocked(week)) throw bad('这一周已结束，只能看不能改', 8197)
  if (typeof contentMd !== 'string') throw bad('contentMd 要是字符串(Markdown 文本)')
  const content = contentMd.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (Buffer.byteLength(content, 'utf8') > CONTENT_MAX_BYTES) throw bad('正文太长(上限 64KB)')
  if (title != null && typeof title !== 'string') throw bad('title 要是字符串')
  const t = String(title ?? '').trim()
  if (t.length > TITLE_MAX) throw bad(`title 最多 ${TITLE_MAX} 字`)
  const by = BigInt(user.id ?? user.userId)
  const before = await prisma.okrWeekPlan.findUnique({ where: keyOf(week), select: { id: true } })
  const p = await prisma.okrWeekPlan.upsert({
    where: keyOf(week),
    update: { title: t || null, contentMd: content, updatedById: by },
    create: { year: week.year, weekNo: week.weekNo, title: t || null, contentMd: content, updatedById: by }
  })
  return { plan: { id: String(p.id), ...(await view(week, p, user)) }, created: !before }
}
