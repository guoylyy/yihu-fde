// OKR 8.0: 导出文件格式(数据见 okrExport.js 的 exportData)
import ExcelJS from 'exceljs'
import { OkrRuleError } from './okrRules.js'

export const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

const notYet = () => { throw new OkrRuleError('该格式尚未实现', { status: 501, code: 8182 }) }

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

/** Word: jszip 手写最小 docx → Buffer */
export async function renderDocx() { return notYet() }
