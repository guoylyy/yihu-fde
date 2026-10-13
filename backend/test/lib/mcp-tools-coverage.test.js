// 单元测试 - MCP 工具集的完整性护栏
//
// 起因: 对接方给了一份《MCP 接口缺口清单》, 里面两个 P0 都是「工具描述里引用了一个不存在的工具」
// (工具描述让模型去调一个当时没注册的工具)。模型照着描述调, 必然报 -32601。
// 所以这里把「引用断裂」钉成回归测试, 而不是只把那两个补上就算完。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { TOOLS } from '../../src/mcp/tools.js'

const MCP_INDEX_SRC = fs.readFileSync(
  path.join(import.meta.dirname, '../../src/mcp/index.js'), 'utf8'
)
const TRAINING = JSON.parse(fs.readFileSync(
  path.join(import.meta.dirname, '../../../fde-agent-training/08-tool-definitions.json'), 'utf8'
))

// multipart 工具走不了 TOOLS 的 JSON 通道, 是在 index.js 里单独 registerTool 的。
// 从源码里抓而不是写死数组 —— 否则谁把它改名了这里也发现不了。
const INLINE_TOOLS = [...MCP_INDEX_SRC.matchAll(/registerTool\(\s*'([a-z0-9_]+)'/g)].map(m => m[1])
const ALL_TOOL_NAMES = new Set([...TOOLS.map(t => t.name), ...INLINE_TOOLS])

/** 用占位值把每个工具的 build 跑一遍 */
function buildWith(tool) {
  const args = {}
  for (const [k, v] of Object.entries(tool.schema || {})) {
    // 只有 build 里做分支判断的布尔参数会影响 path, 两个分支都要覆盖, 见下面的专门用例
    args[k] = v?._def?.type === 'boolean' || v?._def?.innerType?._def?.type === 'boolean'
      ? true
      : `{${k}}`
  }
  return tool.build(args)
}

describe('MCP 工具集基础约束', () => {
  const names = TOOLS.map(t => t.name)

  test('工具名不重复(含 index.js 里内联注册的)', () => {
    const all = [...names, ...INLINE_TOOLS]
    const dup = all.filter((n, i) => all.indexOf(n) !== i)
    assert.deepEqual(dup, [], `重名工具: ${dup.join(', ')}`)
  })

  test('工具名一律 snake_case', () => {
    for (const n of [...names, ...INLINE_TOOLS]) {
      assert.match(n, /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, `工具名不合规范: ${n}`)
    }
  })

  test('每个工具都有像样的描述', () => {
    for (const t of TOOLS) {
      assert.ok(t.description && t.description.length >= 10, `${t.name} 描述太短`)
    }
  })

  test('multipart 工具确实在 index.js 里注册着', () => {
    for (const n of ['upload_file']) {
      assert.ok(INLINE_TOOLS.includes(n), `index.js 里没注册 ${n}`)
    }
  })

  test('每个工具的 build 都产出合法请求', () => {
    for (const t of TOOLS) {
      const b = buildWith(t)
      assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(b.method), `${t.name} method 非法: ${b.method}`)
      assert.ok(b.path.startsWith('/api/'), `${t.name} path 非法: ${b.path}`)
      assert.ok(!b.path.includes('undefined'), `${t.name} path 出现 undefined: ${b.path}`)
      assert.ok(!/\/\//.test(b.path.replace(/^https?:\/\//, '')), `${t.name} path 有空段: ${b.path}`)
    }
  })

  test('路径参数都被 build 填进去了, 没有漏成字面量', () => {
    for (const t of TOOLS) {
      const b = buildWith(t)
      // 占位符形如 {projectId}; 出现在 path 里说明确实是用参数拼的, 属正常
      // 但不该出现 [object Object] 这类拼错的痕迹
      assert.ok(!b.path.includes('[object'), `${t.name} path 拼接有误: ${b.path}`)
    }
  })
})

// ===== 核心护栏: 描述里提到的工具必须真的存在 =====
describe('工具描述不得引用不存在的工具 (P0 回归)', () => {
  test('所有描述里的 snake_case 标识符都是已注册的工具名', () => {
    const broken = []
    for (const t of TOOLS) {
      const texts = [t.description, ...Object.values(t.schema || {}).map(s => s?.description || '')]
      for (const txt of texts) {
        for (const token of String(txt || '').match(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g) || []) {
          if (!ALL_TOOL_NAMES.has(token)) broken.push(`${t.name} 的描述里引用了不存在的工具 "${token}"`)
        }
      }
    }
    assert.deepEqual(broken, [], `\n${broken.join('\n')}\n（要么补上这个工具, 要么改掉描述 —— 模型会照着描述去调）`)
  })

  test('MCP instructions 里提到的工具也都存在', () => {
    const broken = []
    // instructions 是拼在 index.js 源码里的字符串数组
    for (const token of MCP_INDEX_SRC.match(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g) || []) {
      // 只校验形似工具名的 token: 出现在 instructions 段落里的
      if (!MCP_INDEX_SRC.includes(`${token}`)) continue
      if (ALL_TOOL_NAMES.has(token)) continue
      // index.js 里还有变量名/字段名, 只挑 instructions 数组里写到的
      const inInstructions = /instructions: \[[\s\S]*?\]\.join/.exec(MCP_INDEX_SRC)?.[0] || ''
      if (inInstructions.includes(token)) broken.push(`instructions 里引用了不存在的工具 "${token}"`)
    }
    assert.deepEqual(broken, [], broken.join('\n'))
  })
})

// ===== 训练材料同步 (硬规则: 对外接口变更要同步训练包) =====
describe('训练材料 08-tool-definitions.json 与 MCP 同步', () => {
  const trainingNames = new Set(TRAINING.tools.map(t => t.name))

  test('每个 MCP 工具在训练材料里都有条目', () => {
    const missing = [...ALL_TOOL_NAMES].filter(n => !trainingNames.has(n))
    assert.deepEqual(missing, [], `训练材料缺工具: ${missing.join(', ')}`)
  })

  test('训练材料里每个条目都有 method/path/description', () => {
    for (const t of TRAINING.tools) {
      assert.ok(t.description && t.description.length > 5, `${t.name} 描述太短`)
      assert.ok(t.method, `${t.name} 缺 method`)
      assert.ok(t.path && t.path.startsWith('/api/'), `${t.name} path 非法: ${t.path}`)
    }
  })

  test('训练材料的 method 与 MCP 一致', () => {
    for (const t of TOOLS) {
      const doc = TRAINING.tools.find(x => x.name === t.name)
      if (!doc) continue
      assert.equal(doc.method, buildWith(t).method, `${t.name} 的 method 两边不一致`)
    }
  })

  test('训练材料里没有 MCP 已经不提供的工具(反向断裂)', () => {
    // 训练材料里还有一批纯 REST 接口(login 等)不是 MCP 工具, 只查那些看起来是 MCP 工具名的
    const restOnly = new Set(['login', 'refresh_token', 'get_me', 'upload_file'])
    const ghosts = TRAINING.tools
      .map(t => t.name)
      .filter(n => !ALL_TOOL_NAMES.has(n) && !restOnly.has(n) && /^(list|get|create|update|delete|approve|submit|close|verify|assign|issue|sign|convert|score|draft|send|withdraw|generate|mark|add|remove|report|set)_/.test(n))
    assert.deepEqual(ghosts, [], `训练材料里这些工具 MCP 侧并不存在, 模型照着配会调不通: ${ghosts.join(', ')}`)
  })
})

// ===== 边界: 对外发信仍然不给模型 =====
describe('对外通道边界仍然守着', () => {
  const all = [...ALL_TOOL_NAMES]

  test('没有任何发信类工具', () => {
    for (const forbidden of ['send_email', 'send_mail', 'sendEmail']) {
      assert.ok(!all.includes(forbidden), `不该暴露发信工具 ${forbidden}`)
    }
    const sendish = all.filter(n => /send/i.test(n) && /mail|email/i.test(n))
    assert.deepEqual(sendish, [], `发现疑似发信工具: ${sendish.join(', ')}`)
  })

  test('send_notification 打到站内通知接口, 且描述里写明不外发', () => {
    const t = TOOLS.find(x => x.name === 'send_notification')
    const b = t.build({ toUserId: '1', title: 't' })
    assert.equal(b.method, 'POST')
    assert.equal(b.path, '/api/fde/notifications')
    assert.ok(/站内/.test(t.description), 'send_notification 描述要讲清只进站内信箱')
    assert.ok(/不会外发|不外发/.test(t.description), 'send_notification 描述要讲清不外发飞书/邮件')
  })

  test('周报工具已下线(v1.7.5 拍板), 且不暴露任何发布到客户门户的工具', () => {
    const t = TOOLS.find(x => x.name === 'generate_weekly_report')
    assert.equal(t, undefined, 'generate_weekly_report 已于 v1.7.5+ 下线, 不应复活')
    const publishish = TOOLS.filter(x => /publish/.test(buildWith(x).path || ''))
    assert.deepEqual(publishish.map(x => x.name), [], '不该暴露任何发布到客户门户的工具')
  })
})

// ===== 不可逆动作要在描述里提示确认 =====
describe('不可逆/对客户可见的动作必须提示先确认', () => {
  const RISKY = [
    'delete_task', 'delete_milestone', 'delete_issue', 'delete_risk',
    'delete_knowledge_article',
    'approve_timesheet'
  ]

  test('这些工具都还在', () => {
    for (const n of RISKY) assert.ok(ALL_TOOL_NAMES.has(n), `缺工具 ${n}`)
  })

  test('描述里都写了「确认」', () => {
    const missing = RISKY.filter(n => {
      const t = TOOLS.find(x => x.name === n)
      return !/确认/.test(t?.description || '')
    })
    assert.deepEqual(missing, [], `这些不可逆动作的描述里没要求先与用户确认: ${missing.join(', ')}`)
  })
})

// ===== 缺口清单里点名的工具, 逐个钉住 =====
describe('《MCP 接口缺口清单》要求的工具都已补齐', () => {
  const REQUIRED = [
    // A 里程碑
    'list_milestones', 'create_milestone', 'update_milestone', 'close_milestone', 'delete_milestone',
    // B 问题与风险
    'list_issues', 'list_risks', 'delete_issue', 'delete_risk',
    // C 任务
    'list_project_tasks', 'delete_task', 'assign_task', 'verify_task',
    // E 项目
    'update_project', 'create_project', 'add_project_member', 'remove_project_member',
    // G 报表
    'get_timesheet_summary', 'get_team_utilization',
    // I 其他
    'send_notification', 'delete_notification', 'delete_knowledge_article'
  ]

  test('逐个存在', () => {
    const missing = REQUIRED.filter(n => !ALL_TOOL_NAMES.has(n))
    assert.deepEqual(missing, [], `缺口清单里这些还没补: ${missing.join(', ')}`)
  })
})

// ===== 有条件分支的 build: 两条分支都要打对地方 =====
describe('审批类工具的通过/驳回分支都打对接口', () => {
  test('verify_task 打的是状态接口且状态写死 VERIFIED', () => {
    const b = TOOLS.find(x => x.name === 'verify_task').build({ taskId: '9' })
    assert.equal(b.path, '/api/fde/tasks/9/status')
    assert.equal(b.body.status, 'VERIFIED')
  })

  test('close_milestone 走 PUT 并置 COMPLETED', () => {
    const t = TOOLS.find(x => x.name === 'close_milestone')
    const b = t.build({ projectId: '1', milestoneId: '2' })
    assert.equal(b.method, 'PUT')
    assert.equal(b.body.status, 'COMPLETED')
    assert.equal(b.body.actualDate, undefined, '不传实际日期时不该塞 undefined, 由后端填今天')
    assert.equal(t.build({ projectId: '1', milestoneId: '2', actualDate: '2026-08-01' }).body.actualDate, '2026-08-01')
  })

  test('get_team_utilization 固定按人分组', () => {
    const b = TOOLS.find(x => x.name === 'get_team_utilization').build({ from: '2026-08-01', to: '2026-08-31' })
    assert.equal(b.query.groupBy, 'ENGINEER')
  })
})
