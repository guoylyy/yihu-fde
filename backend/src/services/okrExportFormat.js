// OKR 8.0: 导出文件格式(数据见 okrExport.js 的 exportData)
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { getBrand } from '../config/brand.js'

export const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

// ---------------------------------------------------------------- 标签(与页面同一套中文)

export const OBJ_STATUS = { ON_TRACK: '进行中', AT_RISK: '有风险', DONE: '已完成', MISSED: '未达成', DROPPED: '已放弃' }
export const KR_STATUS = { ON_TRACK: '进行中', AT_RISK: '有风险', DONE: '已完成', MISSED: '未完成' }
export const METRIC = { BINARY: '二元', PERCENT: '百分比', NUMBER: '数值', MILESTONE: '阶段' }
export const RISK = { LOW: '低', MEDIUM: '中', HIGH: '高' }
export const SUBMISSION = { NONE: '未提交', LATE: '是', ON_TIME: '否' }

const EMPTY = '-'
/** 空值写 '-'; 数值保持数值(方便 Excel 直接算) */
const v = x => (x === null || x === undefined || x === '' ? EMPTY : x)

// ---------------------------------------------------------------- Excel

export const DETAIL_HEADERS = [
  '周', '负责人', '所属项目', 'O序号', 'O标题', 'O权重', 'O状态', '卡点', '卡在谁', '依赖截止日', '风险',
  'KR序号', 'KR标题', '度量类型', '目标值', '当前值', '完成率', 'KR权重', 'KR状态', 'KR卡点', '自评分', '主管分', '主管评语', '本周进展条数'
]
export const SUMMARY_HEADERS = ['负责人', 'O数', 'KR数', '平均完成率', '平均自评', '平均主管分', '迟交', '本周总结篇数', '高风险O数', '逾期卡点数']

const DETAIL_WIDTHS = [10, 10, 18, 6, 28, 7, 8, 28, 10, 12, 6, 6, 30, 8, 8, 8, 8, 7, 8, 24, 7, 7, 24, 10]
const SUMMARY_WIDTHS = [12, 6, 6, 10, 9, 10, 8, 12, 10, 10]
const PERCENT_FMT = '0%'

function sheetWith(wb, name, headers, widths) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = headers.map((h, i) => ({ header: h, width: widths[i] }))
  ws.getRow(1).font = { bold: true }
  return ws
}

/** 数值列设显示格式; 写的是 '-' 的格子不受影响 */
function numFmt(ws, col, fmt) { ws.getColumn(col).numFmt = fmt }

/** Excel: 明细(每行一个 KR) + 汇总(每人一行) → Buffer */
export async function renderXlsx(data) {
  const wb = new ExcelJS.Workbook()
  wb.created = data.exportedAt
  const detail = sheetWith(wb, '明细', DETAIL_HEADERS, DETAIL_WIDTHS)
  const summary = sheetWith(wb, '汇总', SUMMARY_HEADERS, SUMMARY_WIDTHS)

  for (const p of data.people) {
    for (const o of p.objectives) {
      const oCells = [
        data.week, p.user.name, v(o.projects.join(', ')), o.seq, o.title, v(o.weight), v(OBJ_STATUS[o.status] || o.status),
        v(o.blocker?.text), v(o.blocker?.ownerName), v(o.blocker?.dueDate), v(RISK[o.riskLevel] || o.riskLevel)
      ]
      const scoreCells = [v(o.selfScore), v(o.managerScore), v(o.managerComment)]
      const krs = o.keyResults.length ? o.keyResults : [null]
      for (const k of krs) {
        const kCells = k
          ? [k.seq, k.title, v(METRIC[k.metricType] || k.metricType), v(k.targetValue), v(k.currentValue), v(k.progress), v(k.weight), v(KR_STATUS[k.status] || k.status), v(k.blockers)]
          : Array(9).fill(EMPTY)
        detail.addRow([...oCells, ...kCells, ...scoreCells, k ? k.updates : EMPTY])
      }
    }
    const s = p.summary
    summary.addRow([
      p.user.name, s.objectiveCount, s.krCount, v(s.completion), v(s.selfScore), v(s.managerScore),
      SUBMISSION[s.submission], s.dailySummaries, s.highRiskCount, s.blockerOverdueCount
    ])
  }
  numFmt(detail, 17, PERCENT_FMT)
  numFmt(summary, 4, PERCENT_FMT)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ---------------------------------------------------------------- Word(jszip 手写最小 docx)
// 只有 document.xml + styles.xml: 标题 Heading1/2/3, 正文 Normal; 字体 Microsoft YaHei(eastAsia 也指定, 中文不乱码)。

const FONT = 'Microsoft YaHei'
const DAY_MS = 24 * 3600 * 1000

const pct = x => (x == null ? EMPTY : `${Math.round(x * 100)}%`)
const num = x => (x == null ? EMPTY : String(Math.round(Number(x) * 100) / 100))
const orDash = x => (x == null || x === '' ? EMPTY : x)

/** 上海时间 YYYY-MM-DD HH:mm */
function shanghaiStamp(d) {
  return new Date(new Date(d).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')
}

function krLine(k) {
  const head = `KR${k.seq} ${k.title}`
  if (k.metricType === 'BINARY') return `${head}〔${METRIC.BINARY} ${k.status === 'DONE' ? '已完成' : '未完成'}〕`
  const unit = k.unit ? ` ${k.unit}` : ''
  const value = k.metricType === 'PERCENT'
    ? `${num(k.currentValue)}%/${num(k.targetValue)}%`
    : `${num(k.currentValue)}/${num(k.targetValue)}${unit}`
  return `${head}〔${METRIC[k.metricType] || k.metricType} ${value}〕完成 ${pct(k.progress)}`
}

function blockerLine(b, today) {
  const parts = [`卡在 ${orDash(b.ownerName)}`, `截止 ${orDash(b.dueDate)}`]
  if (b.overdue && b.dueDate) {
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${b.dueDate}T00:00:00Z`)) / DAY_MS)
    parts.push(`已逾期 ${days} 天`)
  }
  return `卡点：${b.text}（${parts.join('，')}）`
}

function scoreLine(o, showManager) {
  let s = `自评 ${orDash(o.selfScore)}`
  if (showManager) {
    s += ` / 主管分 ${orDash(o.managerScore)}`
    if (o.managerComment) s += `（评语：${o.managerComment}）`
  }
  return s
}

/** 标题 / 正文的一串段落: [{ style, text }] */
export function docxOutline(data) {
  const brand = getBrand()
  const org = brand.platformName || brand.name
  const weekLabel = data.week.replace(/^\d{4}-/, '')
  const who = data.scope === 'team' ? '团队' : data.scope === 'person' ? data.subject.name : `项目「${data.subject.name}」`
  const out = [{ style: 'Heading1', text: `${org} ${weekLabel} ${who} OKR（导出时间 ${shanghaiStamp(data.exportedAt)}）` }]
  for (const p of data.people) {
    const s = p.summary
    out.push({ style: 'Heading2', text: `${p.user.name}（O ${s.objectiveCount} 个 / KR ${s.krCount} 条 / 平均完成率 ${pct(s.completion)}）` })
    for (const o of p.objectives) {
      out.push({ style: 'Heading3', text: `O${o.seq} ${o.title}（权重 ${num(o.weight)}% · 状态 ${OBJ_STATUS[o.status] || o.status} · 风险 ${RISK[o.riskLevel] || o.riskLevel}）` })
      if (o.projects.length) out.push({ style: 'Normal', bullet: true, text: `所属项目：${o.projects.join('、')}` })
      for (const k of o.keyResults) {
        out.push({ style: 'Normal', bullet: true, text: krLine(k) + (k.blockers ? `；卡点：${k.blockers}` : '') })
      }
      if (o.blocker) out.push({ style: 'Normal', bullet: true, text: blockerLine(o.blocker, data.today) })
      out.push({ style: 'Normal', bullet: true, text: scoreLine(o, p.showManager) })
    }
  }
  return out
}

const xmlEscape = s => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const RUN_FONT = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>`

function paragraph({ style, text, bullet }) {
  const ppr = `<w:pPr><w:pStyle w:val="${style}"/>${bullet ? '<w:ind w:left="420" w:hanging="210"/>' : ''}</w:pPr>`
  const lines = String((bullet ? '• ' : '') + text).replace(/\r\n?/g, '\n').split('\n')
  const body = lines.map((l, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(l)}</w:t>`).join('')
  return `<w:p>${ppr}<w:r><w:rPr>${RUN_FONT}</w:rPr>${body}</w:r></w:p>`
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`

const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

const heading = (id, name, level, size) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
  `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level}"/></w:pPr><w:rPr>${RUN_FONT}<w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr>${RUN_FONT}<w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr>${RUN_FONT}</w:rPr></w:style>` +
  heading('Heading1', 'heading 1', 0, 32) + heading('Heading2', 'heading 2', 1, 28) + heading('Heading3', 'heading 3', 2, 24) +
  '</w:styles>'

/** Word: 标题 + 每人 / 每个 O 一段 → Buffer */
export async function renderDocx(data) {
  const body = docxOutline(data).map(paragraph).join('')
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const zip = new JSZip()
  // 不写目录条目(_rels/ 这类), 部分严格的读取器不认
  const put = (name, xml) => zip.file(name, xml, { createFolders: false })
  put('[Content_Types].xml', CONTENT_TYPES_XML)
  put('_rels/.rels', ROOT_RELS_XML)
  put('word/document.xml', doc)
  put('word/_rels/document.xml.rels', DOC_RELS_XML)
  put('word/styles.xml', STYLES_XML)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
