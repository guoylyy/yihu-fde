#!/usr/bin/env node
/**
 * 新实例开张: 角色清单入库 + 开第一个管理员账号 (不想要演示数据时代替 prisma/seed.js)
 *
 * prisma migrate deploy 建完表是个空库: roles 表没有行(后端会退回内置角色, 能跑但角色管理页
 * 改不了), 也没有任何用户, 谁都登不进去。这个脚本补上这两步。
 *
 * 幂等: 角色按 code upsert, 用户按 username upsert(已存在则只补角色/状态, 不覆盖密码)。
 *
 * 用法(容器内):
 *   node scripts/seed-instance-admin.mjs --username admin --name '管理员'
 *   node scripts/seed-instance-admin.mjs --username admin --url "mysql://..." --password '自定义'
 *
 * 初始密码默认 123456, 并置 mustChangePassword, 首次登录强制改。
 *
 * 为什么必须是 123456 而不是随机串: 这是平台全局约定(users.js 建号与重置密码都写死它,
 * 站内信/邮件通知也照着它发)。**强制改密页 ChangePassword.vue 在 forced 模式下
 * 隐藏了「当前密码」输入框, 提交时把 oldPassword 硬编码成 '123456'** —— 初始密码给成
 * 别的值, 管理员第一次登录就会卡在「旧密码错误」上, 且界面根本没有地方让他输入正确的旧密码。
 * 要改成随机初始密码, 得先把那个页面改成读用户输入。
 */
import bcrypt from 'bcrypt'
import { BUILTIN_ROLES } from '../src/lib/auth.js'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : null
}

const username = arg('username') || 'admin'
const password = arg('password') || '123456'
const name = arg('name') || '系统管理员'
const role = arg('role') || 'ADMIN'
const url = arg('url') || process.env.DATABASE_URL

if (!url) {
  console.error('没有 DATABASE_URL, 用 --url 指定目标库')
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient({ datasources: { db: { url } } })

const dbName = (url.split('/').pop() || '').split('?')[0]
console.log(`\n==> 目标库: ${dbName}`)

// ① 角色清单入库(与代码里的 BUILTIN_ROLES 同源, 不另起一套)
console.log('\n==> 角色清单')
for (const [i, r] of BUILTIN_ROLES.entries()) {
  const data = { name: r.name, dataScope: r.dataScope, builtin: true, status: r.status, sortOrder: i * 10 }
  await prisma.role.upsert({ where: { code: r.code }, update: data, create: { code: r.code, ...data } })
  console.log(`   ${r.code.padEnd(13)} ${r.name}`)
}

// ② 第一个管理员
console.log('\n==> 管理员账号')
const existing = await prisma.user.findUnique({ where: { username } })
if (existing) {
  await prisma.user.update({
    where: { username },
    data: { role, status: 1, deletedAt: null }
  })
  console.log(`   ${username} 已存在, 只补齐角色(${role})与启用状态, 密码保持不变`)
} else {
  await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      name,
      role,
      status: 1,
      mustChangePassword: true
    }
  })
  console.log(`   已创建 ${username} (${name}, ${role}), 初始密码 ${password}, 首次登录强制改密`)
}

await prisma.$disconnect()
console.log('\n完成。\n')
