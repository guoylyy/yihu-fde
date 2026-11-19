// 0.5.1 上传对话文件: 前端先挡一遍(与后端 routes/fde/devlog.js 同口径), 免得 100MB 的文件传完了才被拒
export const UPLOAD_EXTS = ['.jsonl', '.json', '.log', '.txt', '.md', '.zst', '.gz']
export const UPLOAD_ACCEPT = UPLOAD_EXTS.join(',')
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024
export const UPLOAD_MAX_FILES = 20

/** 1536 → '1.5 KB' */
export function formatSize(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

/** 前端能挡的问题: 'too_big' | 'bad_ext' | null */
export function checkFile(file) {
  const name = String(file?.name || '').toLowerCase()
  if (!UPLOAD_EXTS.some((e) => name.endsWith(e))) return 'bad_ext'
  if ((file?.size || 0) > UPLOAD_MAX_BYTES) return 'too_big'
  return null
}

/**
 * 把新选的文件并进已选列表: 同名同大小的视为同一个, 不重复加; 超过上限的丢掉。
 * @returns {{ list: File[], dropped: number }}
 */
export function mergeFiles(current, incoming, max = UPLOAD_MAX_FILES) {
  const list = [...current]
  let dropped = 0
  for (const f of incoming) {
    if (list.some((x) => x.name === f.name && x.size === f.size)) continue
    if (list.length >= max) { dropped++; continue }
    list.push(f)
  }
  return { list, dropped }
}

/** 摘要首句(规则摘要是「1. xxx\n2. yyy」, 去掉序号), 最长 n 字 */
export function summaryLead(summary, n = 80) {
  const first = String(summary || '').split('\n').map((s) => s.trim()).find(Boolean) || ''
  const t = first.replace(/^\d+[.、)]\s*/, '')
  const m = t.match(/^[\s\S]*?(?:[。！？!?]|\.(?=\s)|$)/)
  const s = (m ? m[0] : t).trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}
