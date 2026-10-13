// 集成测试 - /api/fde/timesheets 工时
// 需要先有一个 project + engineer 才能创建工时
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName, TAG } from './helpers.js'

describe('API: /api/fde/timesheets 工时管理', () => {
  let token, a, projectId, engineerId, createdIds = []

  before(async () => {
    token = await login()
    a = api(token)

    // 获取一个 project + engineer。项目同样避开 unit-test 前缀: 别的测试文件并行建/删的项目随时会消失
    const pl = await a.get('/api/fde/projects?page=1&page_size=50')
    const proj = pl.code === 0 ? (pl.data?.list || []).find(p => !/^unit-test/.test(p.name)) : null
    if (proj) projectId = String(proj.id)

    // engineerId 是 Engineer.id 不是 User.id。
    // 注意别写成"拿列表第一条" —— 库里可能残留着用户已被删掉的孤儿档案,
    // 挑到那种档案建工时会直接 500(Cannot convert null to a BigInt), 用例就会莫名其妙地挂。
    // 这里明确挑一个"关联用户还在"的档案。
    // 挑工程师档案有三条讲究, 都是踩过的坑:
    //   ① 列表返回的是"可派工角色的用户", 没建档案的那几个 id 是 **null** ——
    //      直接取第一条会把 "null" 当 engineerId 传下去, 后端 BigInt(null) 直接 500。
    //   ② 取不到 username 的是孤儿档案(关联用户已被删), 同样建不了工时。
    //   ③ 避开 unit-test 账号: 那是别的测试文件现造的, 并行跑时人家收尾一删,
    //      这边正在用的 engineerId 就凭空消失了。只认种子数据里的真实工程师。
    const el = await a.get('/api/fde/engineers?page=1&page_size=50')
    if (el.code === 0 && el.data?.list?.length) {
      const usable = el.data.list.find(e =>
        e.id != null && e.username && e.name && !/^unit[-x]test/i.test(e.username)
      )
      engineerId = usable ? String(usable.id) : undefined
    }
    // 这一组用例的意义就在于真的建一条工时, 静默 skip 等于没测 —— 拿不到就直接报错
    assert.ok(projectId, '库里没有可用项目, 无法跑工时创建用例')
    assert.ok(engineerId, '库里没有可用的工程师档案(关联用户还在的), 无法跑工时创建用例')
  })

  after(async () => {
    for (const id of createdIds) {
      try { await a.del(`/api/fde/timesheets/${id}`) } catch {}
    }
  })

  // ===== 列表 =====
  describe('GET / 列表', () => {
    test('admin 列出全部工时', async () => {
      const r = await a.get('/api/fde/timesheets')
      assert.equal(r.code, 0)
      assert.ok(Array.isArray(r.data.list))
    })

    test('分页生效', async () => {
      const r = await a.get('/api/fde/timesheets?page=1&page_size=5')
      assert.equal(r.code, 0)
      assert.ok(r.data.list.length <= 5)
    })
  })

  // ===== 创建（需依赖数据） =====
  describe('POST / 创建', () => {
    test('缺 projectId 返回错误', async () => {
      const r = await a.post('/api/fde/timesheets', {
        engineerId, workDate: '2026-06-26', hours: 4, workContent: 'unit test'
      })
      assert.notEqual(r.code, 0)
    })

    test('不传 engineerId = 记当前登录人自己的工时（2026-07-09 起合法）', async () => {
      const r = await a.post('/api/fde/timesheets', {
        projectId, workDate: '2026-06-26', hours: 4, workContent: 'unit-test-self-timesheet'
      })
      assert.equal(r.code, 0)
      assert.ok(r.data.engineerId, '应自动落到当前用户的工程师档案')
      createdIds.push(r.data.id)
    })

    test('缺 workDate 返回错误', async () => {
      const r = await a.post('/api/fde/timesheets', {
        projectId, engineerId, hours: 4, workContent: 'unit test'
      })
      assert.notEqual(r.code, 0)
    })

    test('缺 hours 返回错误', async () => {
      const r = await a.post('/api/fde/timesheets', {
        projectId, engineerId, workDate: '2026-06-26', workContent: 'unit test'
      })
      assert.notEqual(r.code, 0)
    })

    test('缺 workContent 返回错误', async () => {
      const r = await a.post('/api/fde/timesheets', {
        projectId, engineerId, workDate: '2026-06-26', hours: 4
      })
      assert.notEqual(r.code, 0)
    })

    test('合法数据创建工时', async function() {
      if (!projectId || !engineerId) {
        this.skip()
        return
      }
      const r = await a.post('/api/fde/timesheets', {
        projectId, engineerId,
        workDate: '2026-06-26',
        hours: 2,
        workContent: `${TAG}test entry`
      })
      // API 内部 BigInt 转换，这里以 String 传进去
      if (r.code !== 0) {
        console.error('  create failed:', r.code, r.message)
      }
      assert.equal(r.code, 0, `创建失败: ${r.message}`)
      if (r.data?.id) createdIds.push(r.data.id)
    })
  })

  // ===== 单条 =====
  describe('GET /:id', () => {
    test('不存在的 id', async () => {
      const r = await a.get('/api/fde/timesheets/999999999')
      assert.notEqual(r.code, 0)
    })
  })

  // ===== 更新 =====
  describe('PUT /:id', () => {
    test('更新不存在的 id', async () => {
      const r = await a.put('/api/fde/timesheets/999999999', { hours: 1 })
      assert.notEqual(r.code, 0)
    })
  })
})
