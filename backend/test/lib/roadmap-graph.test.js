// 单元测试 - v2.8.0(#1143) 路径图纯函数: 环检测 / 拓扑 / 阻塞与可开始 / 关键路径 / Mermaid
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { findCycle, buildRoadmap } from '../../src/services/roadmap.js'

const T = (id, status = 'TODO', extra = {}) => ({ id, title: `任务${id}`, status, priority: 'MEDIUM', ...extra })
const E = (a, b, type = 'BLOCKS') => ({ id: `${a}${b}`, predecessorId: a, successorId: b, type })

describe('findCycle', () => {
  test('链 1→2→3 上加 3→1 成环, 返回环路', () => {
    const cycle = findCycle([E(1, 2), E(2, 3)], 3, 1)
    assert.deepEqual(cycle, ['1', '2', '3', '1'])
  })
  test('加不成环的边返回 null; 自指也算环', () => {
    assert.equal(findCycle([E(1, 2)], 1, 3), null)
    assert.deepEqual(findCycle([], 5, 5), ['5', '5'])
  })
  test('FEEDBACK 边不参与环检测', () => {
    assert.equal(findCycle([E(1, 2), E(2, 1, 'FEEDBACK')], 2, 3), null)
    assert.equal(findCycle([E(2, 3, 'FEEDBACK')], 3, 2), null)
  })
})

describe('buildRoadmap', () => {
  // 1(完成) → 2(进行中) → 4(待) ; 1 → 3(待) → 4 ; 4 -.回环.-> 2 ; 5 孤立待开始
  const tasks = [T(1, 'DONE'), T(2, 'IN_PROGRESS'), T(3), T(4, 'QUEUED'), T(5, 'TODO', { priority: 'URGENT' })]
  const edges = [E(1, 2), E(1, 3), E(2, 4), E(3, 4), E(4, 2, 'FEEDBACK')]
  const g = buildRoadmap({ tasks, edges, milestone: { id: 9, name: '联调' } })

  test('拓扑序尊重 BLOCKS 边, 同层按优先级', () => {
    assert.deepEqual(g.topoOrder.slice(0, 2), ['5', '1'])   // 5 紧急排前, 1 与 5 同为入口
    assert.ok(g.topoOrder.indexOf('4') > g.topoOrder.indexOf('2'))
    assert.ok(g.topoOrder.indexOf('4') > g.topoOrder.indexOf('3'))
    assert.equal(g.hasCycle, false)
  })
  test('ready = 前置全完成且待开始; blocked = 有未完成的 BLOCKS 前置', () => {
    assert.deepEqual(g.ready.sort(), ['3', '5'])
    assert.deepEqual(g.blocked, ['4'])
    const n4 = g.nodes.find(n => n.id === '4')
    assert.deepEqual(n4.blockedBy.sort(), ['2', '3'])
    assert.equal(g.nodes.find(n => n.id === '2').blocked, false, '前置已完成不阻塞')
  })
  test('入口/终点与边类型', () => {
    assert.deepEqual(g.entries.sort(), ['1', '5'])
    assert.deepEqual(g.terminals.sort(), ['4', '5'])
    assert.equal(g.edges.find(e => e.source === '4' && e.target === '2').type, 'FEEDBACK')
    assert.equal(g.stats.edges, 5)
  })
  test('关键路径: 完成的节点不占工期', () => {
    // 1(0) → 2(1) → 4(1) = 2 天, 1 → 3(1) → 4(1) = 2 天; 取其一, 总 2 天
    assert.equal(g.criticalPath.totalDays, 2)
    assert.equal(g.criticalPath.taskIds.at(-1), '4')
  })
  test('Mermaid 含节点/实线/虚线回环/终点', () => {
    assert.match(g.mermaid, /^flowchart LR/)
    assert.match(g.mermaid, /T1 --> T2/)
    assert.match(g.mermaid, /T4 -\. 回环 \.-> T2/)
    assert.match(g.mermaid, /M9\(\("🏁 联调"\)\)/)
    assert.match(g.mermaid, /T4 --> M9/)
    assert.match(g.mermaid, /class T4 blocked/)
  })
  test('焦点集合: 集合外节点标 external, 且不计入 ready/blocked/stats', () => {
    const f = buildRoadmap({ tasks, edges, focusIds: new Set(['2', '4']) })
    assert.equal(f.nodes.find(n => n.id === '1').external, true)
    assert.deepEqual(f.blocked, ['4'])
    assert.equal(f.stats.total, 2)
  })
  test('两端不全在节点集合里的边被丢弃, 不炸', () => {
    const g2 = buildRoadmap({ tasks: [T(1)], edges: [E(1, 99)] })
    assert.equal(g2.edges.length, 0)
    assert.deepEqual(g2.ready, ['1'])
  })
})
