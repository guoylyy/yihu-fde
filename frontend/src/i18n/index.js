// 界面多语言 (vue-i18n)
//
// 语言优先级: 用户手动选择(localStorage) > 浏览器语言 > 英文。
// 切换语言会整页刷新: 很多状态/类型标签映射表是模块加载时用 t() 生成的常量,
// 刷新后按新语言重新生成, 不必把每张映射表都改成响应式。
import { createI18n } from 'vue-i18n'
import en from '../locales/en.json' with { type: 'json' }
import zhCN from '../locales/zh-CN.json' with { type: 'json' }

export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' }
]
const STORAGE_KEY = 'fde_locale'

function detectLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (LOCALES.some(l => l.code === saved)) return saved
  } catch { /* 隐私模式: 忽略 */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || ''
  return /^zh/i.test(nav) ? 'zh-CN' : 'en'
}

export const locale = detectLocale()

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,   // 模板里直接用 $t
  locale,
  fallbackLocale: 'en',
  messages: { en, 'zh-CN': zhCN },
  missingWarn: false,
  fallbackWarn: false
})

/** 脚本里用的翻译函数(组件外、模块顶层也能用); 与模板里的 $t 同名同义 */
export const t = (...args) => i18n.global.t(...args)
export const $t = t

/** 当前是否中文界面(日期/数字格式等少数需要分支的地方用) */
export const isZh = locale === 'zh-CN'

export function setLocale(code) {
  if (!LOCALES.some(l => l.code === code) || code === locale) return
  try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
  location.reload()
}

if (typeof document !== 'undefined') document.documentElement.lang = locale
