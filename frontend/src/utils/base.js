// 页面所在的路径前缀: 独立部署时为空串; 装在以虎 One 上是 /apps/<code>(后端返回 index.html 时写进 <base href>)
//
// 页面里大量写的是站内绝对路径(fetch('/api/…')、头像 /avatars/…、封面 /covers/…、上传 /uploads/…),
// 不逐个改: installBaseFetch() 包一层 fetch ——
//   - 请求地址: /xxx → <前缀>/xxx
//   - JSON 响应: 字段值是 "/avatars/…" 这类站内资源路径的, 补上前缀(页面直接拿去当 img src)
//   - JSON 请求体: 再把前缀去掉, 库里存的始终是不带前缀的路径(独立部署、换 code 都不受影响)
// 写死在模板里的资源路径和整页跳转用 withBase()。
export const BASE = typeof document === 'undefined' ? '' : new URL(document.baseURI).pathname.replace(/\/+$/, '')

/** 站内绝对路径补上前缀(已带前缀、外部地址、相对路径原样返回) */
export function withBase(p) {
  if (!BASE || typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//')) return p
  return p === BASE || p.startsWith(BASE + '/') ? p : BASE + p
}

const ASSET_DIRS = 'avatars|covers|asset-shots|uploads'
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function installBaseFetch() {
  if (!BASE || window.__baseFetch) return
  window.__baseFetch = true
  const orig = window.fetch.bind(window)
  const addRe = new RegExp(`"\\/(${ASSET_DIRS})\\/`, 'g')
  const stripRe = new RegExp(`"${esc(BASE)}\\/(${ASSET_DIRS})\\/`, 'g')
  window.fetch = async (input, init) => {
    if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//')) return orig(input, init)
    const url = withBase(input)
    if (init && typeof init.body === 'string') init = { ...init, body: init.body.replace(stripRe, '"/$1/') }
    const res = await orig(url, init)
    if (!(res.headers.get('content-type') || '').includes('application/json')) return res
    const text = await res.text()
    const headers = new Headers(res.headers)
    headers.delete('content-length'); headers.delete('content-encoding')
    return new Response(text.replace(addRe, `"${BASE}/$1/`), { status: res.status, statusText: res.statusText, headers })
  }
}
