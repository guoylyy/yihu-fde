// @提及: 认出评论里 @ 到的人
// 页面上的提及选择器插入的是「@姓名 」, 姓名可能带空格(如 "Sam Chen"), 所以不能按 /@\w+/ 截词,
// 而是拿在职用户的姓名 / 用户名去对: 长的先对(避免 "@Sam Chen" 同时命中叫 "Sam" 的人), 对上的那段抹掉再对下一个
import prisma from './prisma.js'

// 名字后面要是空白 / 标点 / 结尾; @ 前面不能是字母数字(排除邮箱 a@b.com)
const AFTER = /^(?:[\s,，.。!！?？:：;；、)）\]】"'”’]|$)/
const BEFORE = /[A-Za-z0-9._%+-]/

/** content 里 @ 到了 users 中的谁(纯函数); users: [{ id, name, username }] */
export function findMentions(content, users) {
  let text = String(content || '')
  if (!text.includes('@')) return []
  const keys = []
  for (const u of users) {
    for (const k of [u.name, u.username]) if (k && String(k).trim()) keys.push({ key: String(k).trim(), user: u })
  }
  keys.sort((a, b) => b.key.length - a.key.length)
  const hit = new Map()
  for (const { key, user } of keys) {
    let i = text.indexOf('@' + key)
    while (i !== -1) {
      const after = text.slice(i + 1 + key.length, i + 2 + key.length)
      const before = i > 0 ? text[i - 1] : ''
      if (AFTER.test(after) && !BEFORE.test(before)) {
        hit.set(String(user.id), user)
        text = text.slice(0, i) + ' '.repeat(key.length + 1) + text.slice(i + 1 + key.length)
      }
      i = text.indexOf('@' + key, i + 1)
    }
  }
  return [...hit.values()]
}

/** 评论内容 → 被 @ 到的在职用户 [{ id, name, username }] */
export async function resolveMentions(content) {
  if (!String(content || '').includes('@')) return []
  const users = await prisma.user.findMany({ where: { deletedAt: null, status: 1 }, select: { id: true, name: true, username: true } })
  return findMentions(content, users)
}
