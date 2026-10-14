// 文件存储 —— 存到 UPLOAD_DIR, 后端在 /uploads 下直接托管
// 装在以虎 One 上时 UPLOAD_DIR=/data/uploads(platform.js), 平台每晚备份 /data; 本地开发默认 ./uploads
// 返回值统一 { url, key }; url 是可直接给浏览器/智能体用的地址。
import fs from 'fs'
import path from 'path'

const DRIVER = 'local'
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads')
/** local 驱动的对外路径前缀, index.js 用它挂静态目录 */
export const LOCAL_URL_PREFIX = '/uploads'

/**
 * 修复 multer 的 originalname 编码：Node 的 busboy 默认把 filename 按 latin1 解析，
 * 中文名会变成乱码字节串。若字符串里只有 0x00-0xFF（疑似 latin1 字节），尝试按 utf8
 * 重新解码；解出替换符 (U+FFFD) 说明原名本来就是合法字符串，原样返回。
 */
export function decodeOriginalName(name) {
  if (!name) return 'file'
  if (/[^\u0000-ÿ]/.test(name)) return name // 含 >0xFF 字符，已是正确解码的字符串
  const decoded = Buffer.from(name, 'latin1').toString('utf8')
  return decoded.includes('�') ? name : decoded
}

/**
 * 生成安全文件名：保留中文等 UTF-8 字符，仅去掉路径分隔符/控制字符/URL 敏感字符，
 * 超长按字符截断并保留扩展名。
 */
export function sanitizeFilename(name, maxLen = 80) {
  let cleaned = path.basename(decodeOriginalName(name))
    .replace(/[\/\\\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*#%&]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') cleaned = 'file'
  const ext = path.extname(cleaned)
  if (cleaned.length > maxLen) {
    cleaned = cleaned.slice(0, Math.max(1, maxLen - ext.length)) + ext
  }
  return cleaned
}

// key 支持 UTF-8，但 URL 中的中文需按段 percent-encode
function keyToUrlPath(key) {
  return key.split('/').map(encodeURIComponent).join('/')
}

function trimSlash(s) {
  return String(s || '').replace(/\/$/, '')
}

// ---------------- local ----------------

/** key 落盘路径; 拒绝跳出 UPLOAD_DIR 的 key */
function localPath(key) {
  const dest = path.resolve(UPLOAD_DIR, key)
  if (!dest.startsWith(UPLOAD_DIR + path.sep)) throw new Error(`非法存储 key: ${key}`)
  return dest
}

function localUrl(key) {
  // 配了 PUBLIC_BASE_URL 时给绝对地址(智能体/邮件里也能打开), 否则同源相对地址
  return `${trimSlash(process.env.PUBLIC_BASE_URL)}${LOCAL_URL_PREFIX}/${keyToUrlPath(key)}`
}

async function localPut(key, { filePath, buffer }) {
  const dest = localPath(key)
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  if (buffer) await fs.promises.writeFile(dest, buffer)
  else await fs.promises.copyFile(filePath, dest)
  return { url: localUrl(key), key }
}

const DRIVERS = { local: localPut }

/**
 * 上传 multer 落盘文件
 * @param {object} file multer 文件对象 {path, originalname, mimetype, size}
 * @returns {Promise<{url: string, key: string}>}
 */
export async function uploadFile(file) {
  const originalname = decodeOriginalName(file.originalname)
  const key = `fde/${new Date().toISOString().slice(0, 10)}/${Date.now()}_${sanitizeFilename(originalname)}`
  const result = await DRIVERS[DRIVER](key, { filePath: file.path, contentType: file.mimetype })
  console.log(`📦 [storage:${DRIVER}] ${originalname} → ${result.url}`)
  return result
}

/**
 * 上传内存 Buffer (服务端生成的文件直传, 不落磁盘)
 * @param {Buffer} buffer
 * @param {string} key 对象 key
 * @returns {Promise<{url: string, key: string}>}
 */
export async function uploadBuffer(buffer, key, contentType) {
  const result = await DRIVERS[DRIVER](key, { buffer, contentType })
  console.log(`📦 [storage:${DRIVER}] buffer(${(buffer.length / 1024).toFixed(1)} KB) → ${result.url}`)
  return result
}

/** 本地驱动给的是同源相对地址; 服务端自己要下载时补成本机绝对地址 */
export function fetchableUrl(url) {
  if (!url || !url.startsWith('/')) return url
  return `http://127.0.0.1:${process.env.PORT || 3005}${url}`
}

export const STORAGE_DRIVER = DRIVER
