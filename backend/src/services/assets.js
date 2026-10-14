// v2.7 项目资产库 (#1140) —— 口径常量 / 发布前脱敏扫描 / 匹配推荐
//
// 匹配推荐是「让资产出现在干活当口」的核心: 任务详情、需求单、Agent 取任务时内联 top3。
// 设计沿用《FDE 工具库方案》的约定: 纯关键词子串匹配(库存小, 不上向量), 低于阈值返空不凑数,
// 任何异常都返空 —— 推荐坏了不能拖垮任务详情这条高频主路径。
import prisma from '../lib/prisma.js'

export const ASSET_LAYERS = ['FRAMEWORK', 'ARCH', 'BIZ']
export const ASSET_LAYER_LABELS = { FRAMEWORK: '项目框架', ARCH: '架构能力', BIZ: '业务能力' }
export const ASSET_MATURITIES = ['L0', 'L1', 'L2', 'L3']
export const ASSET_MATURITY_LABELS = { L0: '线索', L1: '可参考', L2: '可复制', L3: '可安装' }
export const ASSET_STATUSES = ['DRAFT', 'PUBLISHED', 'DEPRECATED']
export const ASSET_AUTHORIZATIONS = ['INTERNAL', 'CLIENT_CLEARED', 'RESTRICTED']
export const ASSET_USAGE_MODES = ['REFERENCE', 'COPY', 'INSTALL']
// 关联对象(新建只能关联这两类); 老数据里的 SKILL_PACKAGE 关联照常展示, Skill 已改到以虎 One 的 Skill 中心
export const ASSET_LINK_TYPES = ['KNOWLEDGE', 'ASSET']

// ---------- 发布前脱敏扫描 ----------

// 密钥样式: 命中即拦截(不给强制通过) —— 七牛/阿里云 AK、OpenAI/Anthropic sk-、JWT、私钥头、长十六进制
const SECRET_PATTERNS = [
  { name: '私钥', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'sk- 形式的 API Key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: '阿里云 AccessKey', re: /\bLTAI[A-Za-z0-9]{12,}/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: '平台 API Key', re: /\b(fde|yhk)_[A-Za-z0-9_-]{16,}/ },
  { name: '疑似密钥赋值', re: /(secret|password|passwd|access[_-]?key|api[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9+/_-]{16,}/i },
  // 40 位是 git commit sha, 方案里引用提交很正常, 放过
  { name: '长十六进制串', re: /\b(?:[a-f0-9]{32,39}|[a-f0-9]{41,})\b/i }
]

function textOf(asset) {
  return [
    asset.name, asset.summary, asset.readme,
    asset.ontology ? JSON.stringify(asset.ontology) : '',
    asset.demoUrl
  ].filter(Boolean).join('\n')
}

// 客户名常以简写出现（如「星河」），只比对全称/录入的简称会漏。这里从全称推一个「核心名」：
// 去掉括号地区、开头的省市、结尾的公司类型与行业后缀。核心名太短或是通用词时不用，避免误伤。
const REGION_PREFIX = /^(北京|上海|天津|重庆|江苏|浙江|广东|山东|四川|湖北|湖南|河南|河北|福建|安徽|江西|辽宁|陕西|云南|广西|深圳|杭州|苏州|南京|成都|武汉|西安|宁波|无锡|厦门|青岛|长沙|合肥|郑州)(省|市)?/
const COMPANY_SUFFIX = /(股份有限公司|有限责任公司|有限公司|集团|公司|科技|技术|贸易|电子|装饰|建设|发展|智能|信息|网络|实业|工业|制造|机电|教育|文化|咨询|服务|电梯|中心)$/
const GENERIC_CORES = new Set(['示范', '示例', '测试', '演示', '中国', '国际', '数据', '智慧', '未来', '创新'])
export function customerCoreName(name) {
  let n = String(name || '').replace(/[（(][^）)]*[）)]/g, '').trim()
  n = n.replace(REGION_PREFIX, '')
  for (let i = 0; i < 4 && COMPANY_SUFFIX.test(n); i++) n = n.replace(COMPANY_SUFFIX, '')
  return n.length >= 2 && !GENERIC_CORES.has(n) ? n : null
}

/**
 * 扫描资产对外可见的文字(方案/本体/Demo)。sourceRepo/sourcePaths 是内部出处, 不扫。
 * @returns {{secrets: string[], customers: string[]}} secrets 必须清掉; customers 是客户名命中(可由经理确认后强制发布)
 */
export async function scanAssetForLeaks(asset) {
  const text = textOf(asset)
  const secrets = SECRET_PATTERNS.filter(p => p.re.test(text)).map(p => p.name)
  const customers = []
  if (text) {
    const rows = await prisma.customer.findMany({
      where: { deletedAt: null },
      select: { name: true, shortName: true }
    })
    for (const c of rows) {
      for (const n of [c.name, c.shortName, customerCoreName(c.name)]) {
        // 两个字以下的简称误伤太多(「星河」这种两字简称仍然要拦)
        if (n && n.length >= 2 && text.includes(n) && !customers.includes(n)) customers.push(n)
      }
    }
  }
  return { secrets, customers }
}

// ---------- 匹配推荐 ----------

export const SUGGEST_THRESHOLD = 0.3

function arr(v) { return Array.isArray(v) ? v.map(String).filter(Boolean) : [] }

/**
 * 给一段上下文(任务标题+描述 / 需求单文本)打分:
 *   keywords 命中是主信号(显式标注的触发词, 最干净), 名称/标签命中是辅助, 成熟度与复用次数做轻微加成。
 *   score = 0.6·K + 0.25·T + 0.15·Q
 *     K = 命中触发词数 / min(触发词数, 3)      —— 命中 3 个就算满分, 不惩罚触发词写得多的资产
 *     T = 资产名出现在文本里 ? 1 : 0
 *     Q = 成熟度(L0 0 ~ L3 1) 与复用(≥3 次满) 各半 —— 同样相关时优先推更成熟的
 */
export function scoreAsset(asset, text) {
  const t = String(text || '').toLowerCase()
  if (!t) return { score: 0, matched: [] }
  const kws = arr(asset.keywords)
  const matched = kws.filter(k => t.includes(k.toLowerCase()))
  const K = kws.length ? Math.min(1, matched.length / Math.min(kws.length, 3)) : 0
  // 只认资产名本身；标签/行业与触发词高度重合，算进来会让「顺口提到一个词」的任务也被推荐
  const T = asset.name && asset.name.length >= 2 && t.includes(asset.name.toLowerCase()) ? 1 : 0
  const mat = { L0: 0, L1: 0.34, L2: 0.67, L3: 1 }[asset.maturity] ?? 0
  const Q = mat * 0.5 + Math.min(1, (asset.usageCount || 0) / 3) * 0.5
  // 关键词一个都没中时不靠名称/成熟度凑分, 否则成熟资产会出现在所有任务里
  if (!matched.length && !T) return { score: 0, matched: [] }
  return { score: Math.round((0.6 * K + 0.25 * T + 0.15 * Q) * 100) / 100, matched }
}

/**
 * 按文本推荐资产; 只推 PUBLISHED。永不抛错。
 * @returns {Promise<Array<{id, slug, name, summary, layer, maturity, score, matchedOn, loadHint}>>}
 */
export async function suggestAssets(text, { limit = 3 } = {}) {
  try {
    if (!text || !String(text).trim()) return []
    const assets = await prisma.asset.findMany({
      where: { deletedAt: null, status: 'PUBLISHED' },
      select: {
        id: true, slug: true, name: true, summary: true, layer: true, maturity: true,
        keywords: true, tags: true, industries: true, usageCount: true, estSavedDays: true
      }
    })
    return assets
      .map(a => ({ a, ...scoreAsset(a, text) }))
      .filter(x => x.score >= SUGGEST_THRESHOLD)
      .sort((x, y) => y.score - x.score)
      .slice(0, Math.max(1, Math.min(10, Number(limit) || 3)))
      .map(({ a, score, matched }) => ({
        id: a.id, slug: a.slug, name: a.name, summary: a.summary,
        layer: a.layer, maturity: a.maturity,
        estSavedDays: a.estSavedDays, usageCount: a.usageCount,
        score, matchedOn: matched,
        loadHint: `调 get_asset(slug='${a.slug}') 看方案与出处; 用上了记得 record_asset_usage 登记复用`
      }))
  } catch (e) {
    console.warn('[suggestAssets]', e.message)
    return []
  }
}

/** 任务上下文文本: 标题 + 描述(截断, 描述动辄上万字) */
export function taskContextText(task) {
  return `${task.title || ''}\n${String(task.description || '').slice(0, 4000)}`
}
