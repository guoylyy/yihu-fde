// OKR 8.0: 导出文件格式(数据见 okrExport.js 的 exportData)
import { OkrRuleError } from './okrRules.js'

export const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

const notYet = () => { throw new OkrRuleError('该格式尚未实现', { status: 501, code: 8182 }) }

/** Excel: 明细 + 汇总两个 sheet → Buffer */
export async function renderXlsx() { return notYet() }

/** Word: jszip 手写最小 docx → Buffer */
export async function renderDocx() { return notYet() }
