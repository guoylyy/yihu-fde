// 本系统版本号: 以 backend/package.json 为准(发版时 release 流程同时改前后端的 package.json)
// 镜像里 package.json 在 /app 下, 本地在 backend/ 下, 都是 src/lib 往上两级
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))

function read() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(dir, '../../package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const APP_VERSION = read()
