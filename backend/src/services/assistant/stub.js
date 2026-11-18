// AI 助手的 stub 大模型: FDE_LLM_STUB=1 且非生产环境时启用(本地 / CI 跑测试用, 不发任何外部请求)。
// 按最后一条用户消息的关键词给出确定的工具调用; 工具执行、草稿校验、确认落库走的都是和真实模型完全相同的路径
export const stubEnabled = () => process.env.FDE_LLM_STUB === '1' && process.env.NODE_ENV !== 'production'

let seq = 0
const call = (name, args) => ({ id: `stub_${++seq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const pick = (text, re) => text.match(re)?.[1]?.trim()

function plan(text) {
  if (/一直查|死循环/.test(text)) return [call('list_my_projects', {})]
  // 0.5.0 会话 / 经验工具: 放在最前, 免得贴进来的对话原文里的「审批」「需求」之类把它带偏
  if (/(记|存|收)[一下]{0,2}[这那]?[段条笔]?(会话|对话)/.test(text)) {
    const body = text.replace(/^[\s\S]*?[：:]\s*/, '')
    const stage = pick(text, /(需求|设计|编码|开发|测试|复盘)阶段/)
    const proj = pick(text, /(?:挂到|到|给)\s*(\S+?)\s*项目/)
    return [call('capture_conversation', { text: body, ...(stage ? { stage } : {}), ...(proj ? { project: proj } : {}) })]
  }
  if (/(关联|挂到|归到|算)/.test(text) && /会话|对话/.test(text)) {
    const id = pick(text, /会话\s*#?(\d+)/) || 'latest'
    const proj = pick(text, /(?:关联到|挂到|归到)\s*(\S+?)\s*项目/)
    const stage = pick(text, /(需求|设计|编码|开发|测试|复盘)阶段/)
    return [call('link_conversation', { conversationId: id, ...(proj ? { project: proj } : {}), ...(stage ? { stage } : {}) })]
  }
  if (/经验|踩过|坑/.test(text) && /搜|找|查|有没有|谁/.test(text)) {
    return [call('search_experience', { keyword: pick(text, /(?:关于|搜|找|查)\s*「?([^」\s]+?)」?\s*的?(?:经验|坑)/) || '' , ...(/坑/.test(text) ? { kind: '踩坑' } : {}) })]
  }
  if (/时间线|各阶段/.test(text)) return [call('project_timeline', { projectName: pick(text, /(\S+?)\s*项目/) })]
  if (/今天|今日/.test(text) && /该干|干啥|有什么事|有啥事|情况|概览/.test(text)) return [call('today', {})]
  if (/审批/.test(text)) return [call('list_pending_approvals', {})]
  const project = pick(text, /给\s*(.+?)\s*项目/) || pick(text, /在\s*(.+?)\s*项目/)
  const after = pick(text, /[：:]\s*(.+)$/)
  if (/建.{0,3}任务|新建任务|加.{0,2}任务/.test(text)) {
    const due = after && pick(after, /^(\S{1,6}?)(?:之)?前/)
    const title = due ? after.replace(/^\S{1,6}?(?:之)?前\s*/, '') : after
    return [call('draft_task', { project, title, ...(due ? { due_date: due } : {}), ...(/紧急/.test(text) ? { priority: '紧急' } : {}) })]
  }
  if (/需求/.test(text) && /记|建|加|录/.test(text)) return [call('draft_requirement', { project, title: after })]
  if (/工时|报工/.test(text) && !/多少|查/.test(text)) {
    const hours = pick(text, /(\d+(?:\.\d+)?\s*小时|半天|一天)/)
    return [call('draft_timesheet', { project, hours, work_content: after, date: pick(text, /(今天|昨天|周[一二三四五六日])/) || '今天' })]
  }
  if (/评论|留言/.test(text)) {
    const task = pick(text, /在\s*(.+?)\s*任务/)
    return [call('draft_comment', { ...(task ? { task } : { project }), content: after })]
  }
  if (/总结|周报/.test(text)) return [call('weekly_report', { week: /上周/.test(text) ? '上周' : '本周' })]
  if (/健康|风险/.test(text) && project) return [call('project_health', { project })]
  if (/任务/.test(text)) return [call('list_my_tasks', { range: /这周|本周/.test(text) ? 'this_week' : /逾期/.test(text) ? 'overdue' : 'all' })]
  if (/工时/.test(text)) return [call('list_my_timesheets', { week: '本周' })]
  if (/搜|找/.test(text)) return [call('search_anything', { keyword: pick(text, /(?:搜|找)(?:一下)?\s*(.+)$/) || text })]
  if (/项目/.test(text)) return [call('list_my_projects', {})]
  return []
}

function summarize(results) {
  const parts = []
  for (const { name, out } of results) {
    if (out?.error) parts.push(`${name} 没成功：${out.error}`)
    else if (out?.draft) parts.push(`已生成${{ task: '任务', requirement: '需求', timesheet: '工时', comment: '评论', conversation: '会话' }[out.kind]}草稿${out.preview ? `（阶段：${out.preview.stage}；摘要：${out.preview.summary}）` : ''}${out.missing?.length ? `，还缺：${out.missing.join('、')}` : ''}，请核对后点「确认」`)
    else if (name === 'link_conversation') parts.push(out.changed.length ? `已改会话 #${out.conversation.id} 的关联：${out.changed.map((c) => `${c.field} ${c.before} → ${c.after}`).join('；')}` : `会话 #${out.conversation.id} 的关联没有变化`)
    else if (name === 'search_experience') parts.push(`找到 ${out.total} 条经验：${out.items.map((x) => `「${x.title}」(#${x.id})`).join('、') || '无'}`)
    else if (name === 'project_timeline') parts.push(`${out.project.name}：${Object.entries(out.stages).map(([k, v]) => `${k} ${v} 条`).join('，')}；最近：${out.recent.map((c) => c.title).join('、') || '无'}`)
    else if (name === 'today') parts.push(`进行中任务 ${out.inProgressTasks.total} 个；待我审批 ${out.pendingApprovals.total} 条；本周 OKR：${out.okrThisWeek.text}；最近会话：${out.recentConversations.list.map((c) => c.title).join('、') || '无'}`)
    else if (name === 'list_my_tasks') parts.push(`共 ${out.total} 个任务：${out.tasks.map((t) => `「${t.title}」${t.dueDate ? `(${t.dueDate}截止)` : ''}`).join('、') || '无'}`)
    else if (name === 'weekly_report') {
      parts.push(`一、完成了什么：${out.completed.map((t) => t.title).join('、') || '无'}\n二、卡在哪：${out.stuck.map((t) => t.title).join('、') || '无'}\n三、下周建议：先处理 ${out.dueNextWeek.map((t) => t.title).join('、') || '手头进行中的任务'}；本周工时 ${out.timesheet.totalHours}h`)
    } else parts.push(`${name} 查到了结果`)
  }
  return `（stub）${parts.join('\n')}`
}

/** 与 chatWithTools 同签名: ({ messages, tools }) → { role, content, tool_calls? } */
export async function stubLLM({ messages, tools }) {
  const last = messages[messages.length - 1]
  if (!tools?.length) return { role: 'assistant', content: '（stub）先停在这里，请把问题拆小一点再问我。' }
  if (last.role === 'tool' || last.role === 'system') {
    // 「一直查」: 模拟模型停不下来, 测 8 轮上限
    const firstUser = [...messages].reverse().find((m) => m.role === 'user')
    if (/一直查|死循环/.test(firstUser?.content || '')) return { role: 'assistant', content: '', tool_calls: [call('list_my_projects', {})] }
    const results = []
    for (let i = messages.length - 1; i >= 0 && messages[i].role === 'tool'; i--) {
      const callMsg = messages.slice(0, i).reverse().find((m) => m.tool_calls?.some((c) => c.id === messages[i].tool_call_id))
      const name = callMsg?.tool_calls.find((c) => c.id === messages[i].tool_call_id)?.function.name
      let out = null
      try { out = JSON.parse(messages[i].content) } catch { /* 忽略 */ }
      results.unshift({ name, out })
    }
    return { role: 'assistant', content: summarize(results) }
  }
  const calls = plan(String(last.content || ''))
  if (!calls.length) return { role: 'assistant', content: '（stub）我可以帮你查任务、建任务/需求/工时/评论草稿、记会话、搜经验、写周报。' }
  return { role: 'assistant', content: '', tool_calls: calls }
}
