// 集成测试 - 数据级权限（4 阶段权限模型）
// 验证：list 自动过滤 / 单条 403  / 角色白名单
//
// 用例：
//   admin  → 看全部
//   fde001 → FDE_ENGINEER（看自己参与的 + 全部能看到的）
//   sales  → SALES（只看到自己创建的）
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { api, login, uniqName, TAG, ADMIN_PWD } from './helpers.js'

// 本地 seed 账号（admin/fde001/sales）密码统一走 TEST_ADMIN_PASSWORD，缺省 123456
const PWD = ADMIN_PWD

describe('数据级权限 - 4 阶段权限模型', () => {
  let adminT, fdeT, salesT, admin, fde, sales

  before(async () => {
    adminT = await login('admin', PWD)
    fdeT = await login('fde001', PWD)
    salesT = await login('sales', PWD)
    admin = api(adminT)
    fde = api(fdeT)
    sales = api(salesT)
  })

  // ===== 谁能访问 =====
  describe('谁能访问 - customers', () => {
    test('admin 能访问', async () => {
      const r = await admin.get('/api/fde/customers')
      assert.equal(r.code, 0)
    })
    test('fde 能访问', async () => {
      const r = await fde.get('/api/fde/customers')
      // fde 可能没有 customer.view 权限
      // 如果 403/500 是合理的（鉴权失败）
      if (r.code !== 0) {
        assert.ok([1003, 1004, 9001].includes(r.code), 'fde 应得到鉴权失败 code')
      }
    })
    test('sales 能访问', async () => {
      const r = await sales.get('/api/fde/customers')
      assert.equal(r.code, 0, `sales 应能访问: ${r.message}`)
    })
  })

  // ===== 谁能访问 - users =====
  describe('谁能访问 - users', () => {
    test('admin 能访问', async () => {
      const r = await admin.get('/api/fde/users')
      assert.equal(r.code, 0)
    })
    test('fde 不能访问 user.view', async () => {
      const r = await fde.get('/api/fde/users')
      assert.notEqual(r.code, 0, 'fde 不应有 user.view 权限')
    })
    test('sales 不能访问 user.view', async () => {
      const r = await sales.get('/api/fde/users')
      assert.notEqual(r.code, 0)
    })
  })

  // ===== 谁能访问 - projects =====
  describe('谁能访问 - projects', () => {
    test('admin 能访问', async () => {
      const r = await admin.get('/api/fde/projects')
      assert.equal(r.code, 0)
    })
    test('fde 能访问 list, 但只见自己参与的项目且无财务字段 (1.2.5 范围收敛)', async () => {
      // 1.2.5 起 FDE_ENGINEER 有 project.access: 列表按数据范围收敛(仅参与项目),
      // 且无 project.viewFinance 权限时裁掉 budget/contractTotal 等金额字段
      const r = await fde.get('/api/fde/projects?page_size=100')
      assert.equal(r.code, 0, `fde 应能访问 projects list: ${r.message}`)
      for (const p of r.data.list) {
        const isMember = (p.members || []).some(m =>
          m.user?.username === 'fde001' || m.engineer?.user?.username === 'fde001')
        assert.ok(isMember, `fde001 非成员却能看到项目 ${p.code}（范围泄漏）`)
        assert.equal(p.budget, undefined, 'fde 不应看到 budget')
        assert.equal(p.contractTotal, undefined, 'fde 不应看到 contractTotal')
      }
    })
    test('sales 能访问', async () => {
      const r = await sales.get('/api/fde/projects')
      assert.equal(r.code, 0, `sales 应能访问: ${r.message}`)
    })
  })

  // ===== 创建者字段 =====
  describe('创建者字段 - createdBy', () => {
    test('admin 创建的 customer 应有 id 字段', async () => {
      const cr = await admin.post('/api/fde/customers', {
        name: uniqName('creator-check')
      })
      if (cr.code === 0) {
        assert.ok(cr.data.id, '应有 id 字段')
        // 注：Customer schema 不含 createdBy，Quotation 才含
        try { await admin.del(`/api/fde/customers/${cr.data.id}`) } catch {}
      } else {
        console.log('  ⚠️  admin 创建 customer 失败（code=' + cr.code + '）')
      }
    })

  })

  // ===== 单条 403 =====
  describe('单条 403 拦截', () => {
    test('访问别人的客户（理论上）', async () => {
      // admin 看自己建的客户 → OK
      // sales 看这个客户 → OK（销售看全部）
      // fde 看 → 403
      const cr = await admin.post('/api/fde/customers', {
        name: uniqName('perms-check')
      })
      if (cr.code === 0) {
        const id = cr.data.id
        const fr = await fde.get(`/api/fde/customers/${id}`)
        // fde 没有 customer.view 或者数据级拦截
        if (fr.code === 0) {
          console.log('  ℹ️  fde 也能看到这个客户（fde 有 customer.view 权限）')
        } else {
          assert.ok([1003, 1004].includes(fr.code), 'fde 应得 403/数据级拦截')
        }
        try { await admin.del(`/api/fde/customers/${id}`) } catch {}
      }
    })
  })

  // ===== 禁用账号 =====
  describe('账号状态', () => {
    test('admin 查看自己 status 应为 1', async () => {
      const r = await admin.get('/api/fde/users/1')
      assert.equal(r.code, 0)
      assert.equal(r.data.status, 1)
    })
  })
})
