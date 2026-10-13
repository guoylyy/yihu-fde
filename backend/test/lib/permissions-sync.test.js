// 单元测试 - 前后端权限矩阵同步 (v1.5.0 新增)
// 硬规则: backend/src/lib/auth.js 的 PERMISSIONS 与 frontend/src/api/permissions.js 必须同步。
// 历史上这条靠人记, 漏改就出现「前端按钮显示了但后端 403」。这里把它变成会失败的测试。
//
// 口径: 前端矩阵是后端目录的子集 —— 前端只需要它真正用来控按钮/菜单的那些点,
// 但凡它列了某个点, 角色列表必须与后端默认值完全一致。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PERMISSIONS as BACKEND } from '../../src/lib/auth.js'
import { PERMISSIONS as FRONTEND } from '../../../frontend/src/api/permissions.js'

describe('前后端权限矩阵同步', () => {
  test('前端列出的权限点在后端目录里都存在', () => {
    const missing = Object.keys(FRONTEND).filter(k => !BACKEND[k])
    assert.deepEqual(missing, [], `前端有、后端没有的权限点: ${missing.join(', ')}`)
  })

  // 已知历史差异: 需要产品拍板才能对齐, 不能由代码单方面改, 先登记在案。
  // 对齐后请把对应项从这里删掉 —— 留着不删会掩盖新出现的漂移。
  const KNOWN_DRIFT = {}

  test('同名权限点的角色列表两边一致', () => {
    const mismatched = []
    for (const [perm, roles] of Object.entries(FRONTEND)) {
      if (!BACKEND[perm]) continue
      const a = [...roles].sort().join(',')
      const b = [...BACKEND[perm]].sort().join(',')
      if (a === b) continue
      const known = KNOWN_DRIFT[perm]
      // 已登记的差异必须与登记内容完全一致, 变了就说明又漂了一次, 照样失败
      if (known && known.frontend === a && known.backend === b) continue
      mismatched.push(`${perm}: 前端[${a}] vs 后端[${b}]`)
    }
    assert.deepEqual(mismatched, [], '角色列表不一致:\n' + mismatched.join('\n'))
  })

  test('已登记的历史差异仍然存在 (修好了就该从 KNOWN_DRIFT 删掉)', () => {
    for (const [perm, d] of Object.entries(KNOWN_DRIFT)) {
      const a = [...(FRONTEND[perm] || [])].sort().join(',')
      const b = [...(BACKEND[perm] || [])].sort().join(',')
      assert.ok(
        a === d.frontend && b === d.backend,
        `${perm} 的差异已变化(前端[${a}] 后端[${b}])，请更新或删除 KNOWN_DRIFT 登记`
      )
    }
  })


})
