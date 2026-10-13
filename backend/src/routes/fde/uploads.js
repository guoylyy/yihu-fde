// 通用文件上传路由（任务附件/交付物等场景复用）
// POST /api/fde/uploads - 单文件上传，返回 { url, key, mock }
import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import os from 'os'
import { internalAuth } from '../../lib/auth.js'
import { uploadFile, decodeOriginalName, sanitizeFilename } from '../../lib/storage.js'
import { pushNotificationToRole } from '../../lib/notify.js'

const router = Router()

const storage = multer.diskStorage({
  destination: path.join(os.tmpdir(), 'fde-uploads'),
  filename: (req, file, cb) => {
    // multer 的 originalname 可能是 latin1 乱码，先转回 utf8 保留中文
    file.originalname = decodeOriginalName(file.originalname)
    cb(null, `${Date.now()}_${sanitizeFilename(file.originalname)}`)
  }
})
const upload = multer({
  storage,
  // v1.2.8: 培训课程支持音视频, 限额 50MB → 200MB
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // 允许：文档/图片/压缩包 + 视频(mp4/mov/webm) + 音频(mp3/wav/m4a/aac/ogg/flac)
    // v1.5.6: 文档/交付物补全办公格式 —— md/markdown、ppt/pptx、rtf、odt/ods/odp
    // (此前前端 accept 已放 .md/.pptx 但这里会拒收; html/svg 仍不放行, 防止被当页面挂到下载域名)
    const ok = /\.(pdf|docx?|xlsx?|pptx?|md|markdown|rtf|odt|ods|odp|jpe?g|png|gif|webp|zip|rar|7z|tar|gz|mp4|mov|webm|mp3|wav|m4a|aac|ogg|flac|txt|csv|json)$/i.test(file.originalname)
    if (!ok) return cb(new Error(`不支持的文件类型: ${path.extname(file.originalname)}`))
    cb(null, true)
  }
})

// multer 的 fileFilter/limits 错误默认走 Express 500 HTML(带堆栈), 这里转成 JSON 400
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ code: 9002, message: err.message })
    next()
  })
}

// POST / - 单文件上传
router.post('/', internalAuth, uploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ code: 400, message: '未收到文件 (字段名: file)' })
    const result = await uploadFile(req.file)
    res.json({
      code: 0,
      data: {
        url: result.url,
        key: result.key,
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    })
  } catch (e) {
    console.error('[UPLOAD] 上传失败:', e.message)
    pushNotificationToRole('ADMIN', { type: 'system', title: 'FDE 文件上传失败', body: e.message }).catch(() => {})
    res.status(500).json({ code: 500, message: '上传失败: ' + e.message })
  }
})

export default router