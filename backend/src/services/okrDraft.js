// 贴周报 → 周 OKR 草稿。模型优先, 规则兜底; 只产出草稿, 绝不写库、不提交。
//
// 产出的草稿交给「我的 OKR」编辑器, 人改完自己点提交; 提交时的硬校验(O 必须有 KR、权重合计 100 等)
// 仍由 okrRules.normalizePlan 在 API 层做, 这里不重复、也不放宽。
import { chatJSON } from '../lib/llm.js'
import { OkrRuleError, METRIC_TYPES, equalWeights, weightsByKrCount, MIN_REPORT_LENGTH } from './okrRules.js'

export { weightsByKrCount, MIN_REPORT_LENGTH }

/** 草稿上限: 比计划上限(3 个 O / 10 个 KR)更紧, 生成的 KR 太多反而没人改 */
export const DRAFT_MAX_OBJECTIVES = 3
export const DRAFT_MAX_KRS = 4
export const MAX_REPORT_LENGTH = 20000
export const MODEL_TIMEOUT_MS = 60000
const TITLE_MAX = 200
const DESC_MAX = 2000
const UNIT_MAX = 10

export const TOO_SHORT_MESSAGE = '内容太短，至少写清本周要交付什么'
export const NO_OBJECTIVE_MESSAGE = '没识别出目标，请把格式改成『目标：… / 完成标准：…』'

// ---------------------------------------------------------------- 规范化 + 截断

const clip = (s, max) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) : t
}

function normKr(k) {
  const title = clip(typeof k === 'string' ? k : k?.title, TITLE_MAX)
  if (!title) return null
  let metricType = METRIC_TYPES.includes(k?.metricType) ? k.metricType : 'BINARY'
  let targetValue = Number(k?.targetValue)
  let unit = null
  if (metricType === 'PERCENT') {
    if (!(targetValue > 0)) targetValue = 100
    unit = '%'
  } else if (metricType === 'NUMBER') {
    // 数值型没给出正的目标值就没法验收, 退回是/否型, 让人自己改
    if (!(targetValue > 0)) metricType = 'BINARY'
    else unit = clip(k?.unit, UNIT_MAX) || null
  }
  if (metricType === 'BINARY') { targetValue = null; unit = null }
  return { title, metricType, unit, targetValue, weight: 0 }
}

/**
 * 把模型/规则的原始结果收拾成编辑器能直接吃的草稿:
 * 去空、超 3 个 O / 4 个 KR 截断(打 truncated 标), 没有 KR 的 O 丢掉, KR 权重均分;
 * O 权重: 原始权重合法(都是数、合计 100、没截断没丢)就保留, 否则按 KR 条数占比重算
 */
export function normalizeDraft(rawObjectives, { keepWeights = false } = {}) {
  let truncated = false
  let list = (Array.isArray(rawObjectives) ? rawObjectives : [])
    .map(o => ({
      title: clip(o?.title, TITLE_MAX),
      description: clip(o?.description, DESC_MAX),
      weight: Number(o?.weight),
      keyResults: (Array.isArray(o?.keyResults) ? o.keyResults : []).map(normKr).filter(Boolean)
    }))
    .filter(o => o.title && o.keyResults.length)
  const dropped = (Array.isArray(rawObjectives) ? rawObjectives.length : 0) !== list.length

  if (list.length > DRAFT_MAX_OBJECTIVES) { list = list.slice(0, DRAFT_MAX_OBJECTIVES); truncated = true }
  for (const o of list) {
    if (o.keyResults.length > DRAFT_MAX_KRS) { o.keyResults = o.keyResults.slice(0, DRAFT_MAX_KRS); truncated = true }
    const ws = equalWeights(o.keyResults.length)
    o.keyResults.forEach((k, i) => { k.weight = ws[i] })
  }

  const given = list.map(o => o.weight)
  const givenOk = keepWeights && !truncated && !dropped && given.every(w => Number.isFinite(w) && w >= 0) &&
    Math.abs(given.reduce((s, w) => s + w, 0) - 100) <= 0.01
  const ws = givenOk ? given.map(w => Math.round(w * 100) / 100) : weightsByKrCount(list.map(o => o.keyResults.length))
  list.forEach((o, i) => { o.weight = ws[i] })
  return { objectives: list, truncated }
}

// ---------------------------------------------------------------- 规则解析

const BULLET = String.raw`(?:[-*•·+]\s*|\d{1,2}\s*[.、)）]\s*)?`
const RE_HEADING = /^#{1,6}\s/
const RE_GOAL = new RegExp(`^${BULLET}(?:\\*\\*)?(?:目标|Objective|O\\d?)\\s*[:：]\\s*(.+)$`, 'i')
const RE_PRIORITY = new RegExp(`^${BULLET}[【\\[]\\s*P\\d\\s*[】\\]]\\s*(.+)$`, 'i')
const RE_BOLD = new RegExp(`^${BULLET}\\*\\*(.+?)\\*\\*(.*)$`)
const RE_ACTION = new RegExp(`^${BULLET}(周[一二三四五六日天])[^:：]{0,20}[:：]\\s*(.+)$`)
const RE_CRITERIA = /(?:完成标准|验收标准|Done when|Acceptance(?: criteria)?)\s*[:：]\s*/i
// 「不按…重排」「本条从上周顺延」这类是说明不是交付, 不当 KR
const RE_NOT_A_GOAL = /^(?:合计|小计|总计|备注|注[:：]|说明|依赖|跟进项)/
const RE_NOT_A_KR = /^(?:不|无需|本条|注|备注|原因|说明|另外)/

/** O 标题: 取到第一个「｜」或句号前 */
function cutTitle(s) {
  return clip(String(s).replace(/\*\*/g, '').split(/[｜|。]/)[0].replace(/[\s：:，,；;]+$/, ''), TITLE_MAX)
}

/** 完成标准后面的内容 → 分句(按 ；。换行), 到下一个「｜」字段为止 */
function criteriaClauses(text) {
  return String(text).split(/[｜|]/)[0]
    .split(/[；;。\n]|\.(?=\s|$)/)
    .map(s => s.replace(/\*\*/g, '').replace(/^[\s，,、]+|[\s，,、]+$/g, ''))
    .filter(s => s.length >= 4 && !RE_NOT_A_KR.test(s))
}

function stripBullet(line) {
  return line.replace(new RegExp(`^${BULLET}`), '').trim()
}

/** 汉字/字母二元组(不含数字, 免得「0.75 人天」这类工时数字凑出假匹配), 用来给「行动方案」行和 O 配对 */
function bigrams(s) {
  const t = String(s).replace(/[^\p{L}]/gu, '')
  const set = new Set()
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
  return set
}

function overlap(a, b) {
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n
}

function objectiveCandidate(line) {
  if (RE_NOT_A_GOAL.test(stripBullet(line.replace(/\*\*/g, '')))) return null
  let m = RE_GOAL.exec(line)
  if (m) return { title: cutTitle(m[1]), rest: m[1] }
  m = RE_PRIORITY.exec(line)
  if (m) return { title: cutTitle(m[1]), rest: m[1] }
  m = RE_BOLD.exec(line)
  if (m) return { title: cutTitle(m[1]), rest: m[1] + m[2] }
  return null
}

/**
 * 纯规则把周报拆成候选 O/KR(不截断、不配权重, 交给 normalizeDraft):
 *  1. 标题分节里的 `**加粗**` 行、`- 【P0】…` 行、`目标：…` 行 → 候选 O(标题取到第一个「｜」或句号前)
 *  2. 同一节里「完成标准：」「验收标准：」后面的分句 → 这个 O 的候选 KR;
 *     「完成标准：」单独成行时, 紧跟的列表项也算
 *  3. `- 周X：…` 行动方案: 某个 O 一条 KR 都没有时, 挑和 O 标题字面最接近的分句当 KR
 */
export function parseReportByRules(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const objs = []
  const actions = []
  let cur = null
  let collecting = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (RE_HEADING.test(line)) { cur = null; collecting = false; continue }

    const act = RE_ACTION.exec(line)
    if (act) { actions.push({ day: act[1], body: act[2] }); collecting = false; continue }

    const cand = objectiveCandidate(line)
    if (cand && cand.title) {
      cur = { title: cand.title, description: '', keyResults: [] }
      objs.push(cur)
      collecting = false
      const crit = RE_CRITERIA.exec(cand.rest)
      if (crit) {
        const after = cand.rest.slice(crit.index + crit[0].length)
        cur.description = clip(after.split(/[｜|]/)[0], DESC_MAX)
        cur.keyResults.push(...criteriaClauses(after))
        collecting = !after.trim()
      }
      continue
    }
    if (!cur) continue

    const crit = RE_CRITERIA.exec(line)
    if (crit) {
      const after = line.slice(crit.index + crit[0].length)
      if (after.trim()) cur.keyResults.push(...criteriaClauses(after))
      if (!cur.description) cur.description = clip(after, DESC_MAX)
      collecting = !after.trim()
      continue
    }
    // 「完成标准：」下面的列表项
    if (collecting && /^(?:[-*•·+]|\d{1,2}\s*[.、)）])/.test(line)) {
      const s = stripBullet(line).replace(/\*\*/g, '')
      if (s.length >= 4 && !RE_NOT_A_KR.test(s)) cur.keyResults.push(s)
      continue
    }
    collecting = false
  }

  // 行动方案补 KR: 只给一条 KR 都没有的 O
  const pieces = actions.flatMap(a => a.body.split(/[；;。]/)
    .map(s => s.trim()).filter(s => s.length >= 4)
    .map(s => ({ text: `${a.day}：${s}`, grams: bigrams(s) })))
  for (const o of objs) {
    if (o.keyResults.length) continue
    const g = bigrams(o.title)
    o.keyResults = pieces
      .map((p, i) => ({ p, i, score: overlap(g, p.grams) }))
      .filter(x => x.score >= 2)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, DRAFT_MAX_KRS)
      .sort((a, b) => a.i - b.i) // 选最相关的, 但按周一→周五的顺序排
      .map(x => x.p.text)
  }

  return objs.map(o => ({ ...o, keyResults: o.keyResults.map(title => ({ title, metricType: 'BINARY' })) }))
}

// ---------------------------------------------------------------- 模型

export const DRAFT_SYSTEM_PROMPT = `你是周 OKR 起草助手。用户会贴来一份本周计划或周报, 你把它整理成本周 OKR 草稿。

只输出一个 JSON 对象, 不要任何解释、不要 Markdown 代码块。结构固定为:
{"objectives":[{"title":"…","weight":50,"keyResults":[{"title":"…","metricType":"BINARY","unit":null,"targetValue":null}]}]}

要求:
1. objectives 1–3 个; 每个 objective 的 keyResults 1–4 个。宁少勿多, 相近的事合并成一个目标。
2. 所有 objective 的 weight 是整数, 合计正好 100, 越重要越高。
3. title 不超过 40 字, 写成本周要达成的结果, 不要写「本周工作」「推进 xx」这类空话。
4. KR 必须可验证: 写清交付物/动作 + 时间点或数量, 周五能明确判断做没做到(如「周四上线并交财务实际跑一轮」)。
5. metricType 只能是 BINARY(做到/没做到)、NUMBER(数量, 必须给 unit 和大于 0 的 targetValue)、PERCENT(百分比, targetValue 为 0–100)。拿不准就用 BINARY, 此时 unit 与 targetValue 为 null。
6. 只用周报里出现的信息, 不要编造项目名、人名、数字。`

const badShape = (msg) => Object.assign(new Error(msg), { code: 'LLM_BAD_JSON' })

/** 带总时限的模型调用: 非法 JSON / 结构不对重试 1 次; 两次共用同一个时限 */
async function askModel(text, llm, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now()
    if (left <= 0) throw Object.assign(new Error('模型超时'), { code: 'LLM_TIMEOUT' })
    try {
      const out = await withTimeout(llm({ system: DRAFT_SYSTEM_PROMPT, user: text, maxTokens: 2000, timeoutMs: left }), left)
      if (!out || !Array.isArray(out.objectives)) throw badShape('模型返回缺少 objectives 数组')
      return out.objectives
    } catch (e) {
      lastErr = e
      if (e.code !== 'LLM_BAD_JSON') throw e
    }
  }
  throw lastErr
}

function withTimeout(promise, ms) {
  let timer
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('模型超时'), { code: 'LLM_TIMEOUT' })), ms)
  })
  return Promise.race([promise, t]).finally(() => clearTimeout(timer))
}

function fallbackReasonOf(e) {
  if (e?.code === 'LLM_NOT_CONFIGURED') return 'not_configured'
  if (e?.code === 'LLM_TIMEOUT' || /超时/.test(e?.message || '')) return 'timeout'
  if (e?.code === 'LLM_BAD_JSON') return 'invalid_json'
  return 'model_error'
}

/**
 * 生成草稿。返回 { mode: 'model'|'rules', fallbackReason, truncated, objectives }
 * 文本太短 / 一个目标都识别不出 → OkrRuleError(8130 / 8131), 界面保留原文
 */
export async function generateOkrDraft(text, { llm = chatJSON, timeoutMs = MODEL_TIMEOUT_MS, log = console } = {}) {
  const src = String(text ?? '').trim()
  if (src.replace(/\s+/g, '').length < MIN_REPORT_LENGTH) throw new OkrRuleError(TOO_SHORT_MESSAGE, { code: 8130 })
  const input = src.slice(0, MAX_REPORT_LENGTH)

  let fallbackReason = null
  try {
    const raw = await askModel(input, llm, timeoutMs)
    const draft = normalizeDraft(raw, { keepWeights: true })
    if (draft.objectives.length) return { mode: 'model', fallbackReason: null, ...draft }
    fallbackReason = 'model_empty'
  } catch (e) {
    fallbackReason = fallbackReasonOf(e)
    if (fallbackReason !== 'not_configured') log.warn?.(`[okr draft] 模型生成失败(${fallbackReason}), 改用规则解析: ${e.message}`)
  }

  const draft = normalizeDraft(parseReportByRules(input))
  if (!draft.objectives.length) throw new OkrRuleError(NO_OBJECTIVE_MESSAGE, { code: 8131, status: 422 })
  return { mode: 'rules', fallbackReason, ...draft }
}
