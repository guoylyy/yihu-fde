// 0.5.0 会话摘要与抽取: 有模型走 chatJSON, 没有 / 超时 / 出错降级规则(mode:'rules')
// 产出 { summary, decisions[], pitfalls[], artifacts[], tags[], stageSuggestion }
// 落库只写 summary/decisions/pitfalls/tags; stage 只在当前是 GENERAL 时才按建议回填, 不覆盖人选的阶段
import prisma from '../../lib/prisma.js'
import { chatJSON, getActiveLlmConfig, LlmNotConfiguredError } from '../../lib/llm.js'
import { stubEnabled } from '../assistant/stub.js'
import { STAGES, messagesOf, textOf, ruleSummary, transcriptForModel } from './conversations.js'

export const SUMMARY_SYSTEM = [
  '你在整理一段软件开发过程中的 AI 会话记录，输出给交付平台做过程沉淀。',
  '只输出一个 JSON 对象，不要任何解释：',
  '{"summary": string, "decisions": string[], "pitfalls": string[], "artifacts": string[], "tags": string[], "stageSuggestion": string|null}',
  'summary：3~5 句中文，讲清楚这次会话要解决什么、做了什么、结论是什么。',
  'decisions：做出的技术/方案决策，每条一句，写成「决定了什么 + 为什么」；没有就空数组。',
  'pitfalls：踩到的坑，每条写成「现象 + 原因 + 解法」；没有就空数组。',
  'artifacts：产出物（改动的文件路径、commit、文档、接口），每条一项；没有就空数组。',
  'tags：3~8 个短标签（技术栈、模块名）。',
  `stageSuggestion：这段会话主要属于哪个阶段，只能是 ${STAGES.filter((s) => s !== 'GENERAL').join(' / ')} 之一；判断不出就填 null。`,
  '只用记录里出现的事实，不要编造。'
].join('\n')

const MODEL_TIMEOUT_MS = 45_000
const MAX_ITEMS = 20

export const strList = (v, n = MAX_ITEMS) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, n).map((s) => s.slice(0, 500)) : [])
const uniq = (arr) => [...new Set(arr.map((s) => s.trim()).filter(Boolean))]

// ---------- 规则抽取 ----------

const DECISION_START = /^(?:决定|结论|就用|改成)/
const PITFALL_START = /^(?:报错|失败|error\b|踩坑|坑)/i
// 「commit abc1234」/「提交 abc1234」/ 括号里的 sha「(25cbcc8)」
const COMMIT_RE = /(?:\bcommit\s+|提交\s*|[（(])([0-9a-f]{7,40})\b/gi

/** 文本切句: 按中英文句末标点与换行切, 去掉列表符号/引用符/加粗 */
export function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[。！？!?；;])|\n+|(?<=\.)\s+/)
    .map((s) => s.replace(/^[\s>*#\-•·]+/, '').replace(/^\d+[.、)]\s*/, '').replace(/\*\*/g, '').trim())
    .filter((s) => s.length >= 2)
}

/** 句首命中关键词的句子(去重, 每条最长 300 字) */
function pickSentences(texts, re, max = 10) {
  const out = []
  for (const t of texts) {
    for (const s of sentencesOf(t)) {
      if (re.test(s) && !out.includes(s)) out.push(s.slice(0, 300))
      if (out.length >= max) return out
    }
  }
  return out
}

export function detectCommits(texts) {
  const out = new Set()
  for (const t of texts) for (const m of String(t || '').matchAll(COMMIT_RE)) out.add(m[1].toLowerCase())
  return [...out].slice(0, 20)
}

// 阶段建议的关键词; 命中数最高且 ≥2、且明显多于第二名才给建议
const STAGE_KEYWORDS = {
  REQUIREMENT: ['需求', '口径', '范围'],
  TEST: ['报错', '测试', '用例'],
  CODING: ['提交', 'diff', '编译']
}

export function suggestStage(texts) {
  const all = texts.join('\n').toLowerCase()
  const scores = Object.entries(STAGE_KEYWORDS).map(([stage, kws]) => [
    stage, kws.reduce((n, k) => n + (all.split(k.toLowerCase()).length - 1), 0)
  ]).sort((a, b) => b[1] - a[1])
  const [[top, n1], [, n2]] = scores
  return n1 >= 2 && n1 >= n2 * 2 && n1 > n2 ? top : null
}

/** 规则版: 摘要=前 3 条 user 首句(+文件); 决策/坑=事件 + 句首关键词; 产出=文件 + commit */
export function ruleExtract(conv, events = []) {
  const base = ruleSummary(conv, events)
  const texts = messagesOf(conv.body).map(textOf).filter(Boolean)
  const eventTexts = events.map((e) => e.text)
  const commits = uniq([...detectCommits([...texts, ...eventTexts]), ...strList(conv.commitShas).map((s) => s.toLowerCase())])
  return {
    summary: base.summary,
    decisions: uniq([...base.decisions, ...pickSentences(texts, DECISION_START)]).slice(0, MAX_ITEMS),
    pitfalls: uniq([...base.pitfalls, ...pickSentences(texts, PITFALL_START)]).slice(0, MAX_ITEMS),
    artifacts: [...base.files, ...commits.map((c) => `commit ${c}`)].slice(0, 40),
    tags: base.tags,
    stageSuggestion: suggestStage([conv.title || '', ...texts, ...eventTexts]),
    files: base.files
  }
}

// ---------- 模型 ----------

async function modelExtract(conv, events) {
  const config = await getActiveLlmConfig()
  const out = await chatJSON({ system: SUMMARY_SYSTEM, user: transcriptForModel(conv, events), maxTokens: 2000, config, timeoutMs: MODEL_TIMEOUT_MS })
  if (!out || typeof out.summary !== 'string' || !out.summary.trim()) return null
  const st = typeof out.stageSuggestion === 'string' ? out.stageSuggestion.trim().toUpperCase() : ''
  return {
    summary: out.summary.trim().slice(0, 20000),
    decisions: strList(out.decisions),
    pitfalls: strList(out.pitfalls),
    artifacts: strList(out.artifacts, 40),
    tags: strList(out.tags, 10),
    stageSuggestion: STAGES.includes(st) && st !== 'GENERAL' ? st : null
  }
}

/**
 * 出摘要(不落库)。返回 { mode: 'model'|'rules', reason?, summary, decisions, pitfalls, artifacts, tags, stageSuggestion, files? }
 * @param {object} conv  含 body / title / commitShas 的会话行
 */
export async function summarizeConversation(conv, events = []) {
  let reason = null
  if (stubEnabled()) reason = 'stub 模式'
  else {
    try {
      const r = await modelExtract(conv, events)
      if (r) return { mode: 'model', ...r }
      reason = '模型没有返回 summary'
    } catch (e) {
      reason = e instanceof LlmNotConfiguredError ? e.message : `模型调用失败：${String(e.message || e).slice(0, 200)}`
      if (!(e instanceof LlmNotConfiguredError)) console.error('[devlog summarize]', e.message)
    }
  }
  return { mode: 'rules', reason, ...ruleExtract(conv, events) }
}

/**
 * 把摘要写回会话: summary/decisions/pitfalls/tags 覆盖; stage 只在 GENERAL 且有建议时回填。
 * @returns {{ stageApplied: boolean, stage: string }}
 */
export async function applySummary(conv, result) {
  const data = { summary: result.summary, decisions: result.decisions, pitfalls: result.pitfalls, tags: result.tags }
  const stageApplied = conv.stage === 'GENERAL' && !!result.stageSuggestion && result.stageSuggestion !== 'GENERAL'
  if (stageApplied) data.stage = result.stageSuggestion
  await prisma.devConversation.update({ where: { id: conv.id }, data })
  return { stageApplied, stage: stageApplied ? result.stageSuggestion : conv.stage }
}

/** 摘要+落库一步到位, 返回给接口的结构 */
export async function summarizeAndApply(conv, events = []) {
  const r = await summarizeConversation(conv, events)
  const applied = await applySummary(conv, r)
  return { ...r, ...applied }
}
