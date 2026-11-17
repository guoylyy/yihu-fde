// AI 助手的对话循环: 模型 ⇄ 工具, 最多 MAX_TOOL_ROUNDS 轮工具调用; 到上限就停, 让模型基于已有结果如实回答
// 纯逻辑(模型与工具执行都由调用方注入), 方便单测
export const MAX_TOOL_ROUNDS = 8
const TOTAL_TIMEOUT_MS = 110_000

/**
 * @param {object} o
 * @param {(req: { messages, tools?, timeoutMs }) => Promise<{ content, tool_calls? }>} o.llm
 * @param {string} o.system   系统提示词
 * @param {Array<{ role: 'user'|'assistant', content: string }>} o.history  含本轮用户消息
 * @param {Array} o.tools      OpenAI function 定义
 * @param {(name: string, args: object) => Promise<object>} o.execTool
 * @returns {Promise<{ reply: string, rounds: number, calls: Array<{ name, ok, ms }>, stopped: string|null }>}
 */
export async function runConversation({ llm, system, history, tools, execTool, maxRounds = MAX_TOOL_ROUNDS, timeoutMs = TOTAL_TIMEOUT_MS }) {
  const convo = [{ role: 'system', content: system }, ...history]
  const calls = []
  const deadline = Date.now() + timeoutMs
  let rounds = 0
  let stopped = null
  let reply = ''

  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 1000) { stopped = 'timeout'; break }
    const capped = rounds >= maxRounds
    const msg = await llm({ messages: convo, tools: capped ? undefined : tools, timeoutMs: remaining })
    if (!msg.tool_calls?.length || capped) { reply = msg.content || ''; break }
    convo.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls })
    rounds++
    for (const tc of msg.tool_calls) {
      const name = String(tc.function?.name || '')
      let args = {}
      try { args = JSON.parse(tc.function?.arguments || '{}') || {} } catch { args = {} }
      const started = Date.now()
      let out
      try {
        out = await execTool(name, args)
      } catch (e) {
        out = { error: e.message || String(e) }
      }
      calls.push({ name, ok: !out?.error, ms: Date.now() - started })
      convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out ?? null).slice(0, 12000) })
    }
    if (rounds >= maxRounds) {
      stopped = 'max_rounds'
      convo.push({ role: 'system', content: `工具调用已达上限 ${maxRounds} 轮，不能再调用工具。请只根据上面已拿到的结果回答用户，并如实说明哪些还没查完。` })
    }
  }

  if (stopped === 'max_rounds') reply = `（已连续调用 ${maxRounds} 轮工具，按上限停下）\n${reply || '还没理完，请把问题拆小一点再问我。'}`
  if (stopped === 'timeout') reply = `（这次处理超时，先停在这里）${reply ? '\n' + reply : '请稍后再试，或把问题拆小一点。'}`
  return { reply, rounds, calls, stopped }
}
