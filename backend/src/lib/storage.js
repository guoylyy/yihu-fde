// 文件存储 —— 三种驱动, 由环境变量决定:
//
//   STORAGE_DRIVER=local   默认。存到 UPLOAD_DIR(默认 ./uploads), 后端在 /uploads 下直接托管
//   STORAGE_DRIVER=s3      任意 S3 兼容存储(AWS S3 / MinIO / Cloudflare R2 / 阿里云 OSS 等)
//                          S3_BUCKET, S3_REGION, S3_ENDPOINT?, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
//                          S3_PUBLIC_URL?(对外访问前缀, 如 CDN 域名), S3_FORCE_PATH_STYLE?(MinIO 填 true)
//   STORAGE_DRIVER=qiniu   七牛云: QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET, QINIU_DOMAIN, QINIU_REGION?
//
// 未显式指定时: 配了 S3_BUCKET 走 s3, 配了 QINIU_ACCESS_KEY 走 qiniu, 否则 local。
// 返回值统一 { url, key }; url 是可直接给浏览器/智能体用的地址。
import fs from 'fs'
import path from 'path'

export function resolveDriver(env = process.env) {
  const explicit = String(env.STORAGE_DRIVER || '').toLowerCase()
  if (['local', 's3', 'qiniu'].includes(explicit)) return explicit
  if (env.S3_BUCKET) return 's3'
  if (env.QINIU_ACCESS_KEY) return 'qiniu'
  return 'local'
}

const DRIVER = resolveDriver()
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

// ---------------- s3 ----------------

let s3Client = null
async function s3() {
  if (s3Client) return s3Client
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
      : undefined
  })
  s3Client = { client, PutObjectCommand }
  return s3Client
}

function s3Url(key) {
  const bucket = process.env.S3_BUCKET
  if (process.env.S3_PUBLIC_URL) return `${trimSlash(process.env.S3_PUBLIC_URL)}/${keyToUrlPath(key)}`
  if (process.env.S3_ENDPOINT) return `${trimSlash(process.env.S3_ENDPOINT)}/${bucket}/${keyToUrlPath(key)}`
  return `https://${bucket}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com/${keyToUrlPath(key)}`
}

async function s3Put(key, { filePath, buffer, contentType }) {
  const { client, PutObjectCommand } = await s3()
  const body = buffer || fs.createReadStream(filePath)
  await client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || undefined
  }))
  return { url: s3Url(key), key }
}

// ---------------- qiniu ----------------

let qiniuSdk = null
async function qiniu() {
  if (!qiniuSdk) {
    const sdk = await import('qiniu')
    qiniuSdk = sdk.default || sdk   // qiniu v7 是 CJS
  }
  return qiniuSdk
}

async function qiniuPut(key, { filePath, buffer }) {
  const q = await qiniu()
  const mac = new q.auth.digest.Mac(process.env.QINIU_ACCESS_KEY, process.env.QINIU_SECRET_KEY)
  const uploadToken = new q.rs.PutPolicy({ scope: process.env.QINIU_BUCKET }).uploadToken(mac)
  const config = new q.conf.Config()
  const zoneMap = { z0: q.zone.Zone_z0, z1: q.zone.Zone_z1, z2: q.zone.Zone_z2, na0: q.zone.Zone_na0, as0: q.zone.Zone_as0 }
  config.zone = zoneMap[process.env.QINIU_REGION || 'z0'] || q.zone.Zone_z0
  const uploader = new q.form_up.FormUploader(config)
  const putExtra = new q.form_up.PutExtra()
  return new Promise((resolve, reject) => {
    const done = (err, body, info) => {
      if (err) return reject(err)
      if (info.statusCode !== 200) {
        return reject(new Error(`七牛上传失败 status=${info.statusCode}: ${JSON.stringify(body)}`))
      }
      resolve({ url: `${trimSlash(process.env.QINIU_DOMAIN)}/${keyToUrlPath(key)}`, key })
    }
    if (buffer) uploader.put(uploadToken, key, buffer, putExtra, done)
    else uploader.putFile(uploadToken, key, filePath, putExtra, done)
  })
}

const DRIVERS = { local: localPut, s3: s3Put, qiniu: qiniuPut }

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
