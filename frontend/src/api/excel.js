// 通用 Excel 下载工具
import { ElMessage } from 'element-plus'
import { $t } from '../i18n/index.js'

function getToken() { return localStorage.getItem('fde_internal_token') || '' }

/**
 * 下载后端返回的 .xlsx
 * @param {string} url - 完整 URL（带 query）
 * @param {string} filename - 下载文件名（含 .xlsx）
 */
export async function downloadExcel(url, filename) {
  ElMessage.info($t('excel.generating_report'))
  try {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + getToken() } })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    ElMessage.success($t('excel.report_downloaded'))
  } catch (e) {
    ElMessage.error($t('excel.export_failed') + (e.message || $t('excel.unknown_error')))
  }
}
