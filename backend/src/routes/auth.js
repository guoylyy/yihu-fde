// 认证路由：内部员工账号密码登录
// (2026-07-09 移除客户手机号验证码登录/客户 portal, 系统只保留官网 + FDE 内部协作)
import express from 'express'
import bcrypt from 'bcrypt'
import prisma from '../lib/prisma.js'
import { signToken, internalAuth } from '../lib/auth.js'

const router = express.Router()

/**
 * POST /api/auth/login
 * 内部员工账号密码登录
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password, remember } = req.body
    if (!username || !password) {
      return res.status(400).json({ code: 1001, message: '参数错误' })
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: { engineer: true }
    })

    if (!user || user.status !== 1) {
      return res.status(401).json({ code: 2003, message: '账号或密码错误' })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return res.status(401).json({ code: 2003, message: '账号或密码错误' })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    })

    // 1.2.7: 勾选"下次自动登录"发 30 天长效 token, 否则用默认有效期
    const token = signToken({
      type: 'internal',
      userId: user.id,
      username: user.username,
      role: user.role,
      engineerId: user.engineer?.id
    }, remember ? '30d' : undefined)

    res.json({
      code: 0,
      message: 'ok',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          engineerId: user.engineer?.id,
          avatarUrl: user.avatarUrl || null,
          mustChangePassword: !!user.mustChangePassword
        }
      }
    })
  } catch (e) {
    console.error('[auth/login]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', internalAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(req.user.userId) },
      include: { engineer: true }
    })
    if (!user) return res.status(404).json({ code: 2004, message: '用户不存在' })
    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        phone: user.phone,
        email: user.email,
        engineerId: user.engineer?.id || null,
        mustChangePassword: !!user.mustChangePassword
      }
    })
  } catch (e) {
    console.error('[auth/me]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router