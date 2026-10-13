// v1.3.2 动态角色 helper — 全站角色下拉/标签/矩阵列的唯一取数口
// 角色清单来自 GET /api/fde/roles (roles 表), 缓存 localStorage; 拉取失败回退内置角色。
// 用法:
//   import { roleLabel, roleTagType, activeRoles, refreshRoles } from '@/api/roles.js'
//   onMounted(refreshRoles)  // 进后台时刷新一次
import { ref, computed } from 'vue'
import { $t } from '../i18n/index.js'

const CACHE_KEY = 'fde_roles'

// 内置角色兜底 (与后端 BUILTIN_ROLES 一致)
const BUILTIN_ROLES = [
  { code: 'ADMIN', name: $t('roles.administrator'), dataScope: 'ALL', builtin: true, status: 1 },
  { code: 'PLATFORM', name: $t('common.operations'), dataScope: 'ALL', builtin: true, status: 1 },
  { code: 'MANAGER', name: $t('common.project_manager'), dataScope: 'OWN_PROJECTS', builtin: true, status: 1 },
  { code: 'FDE_ENGINEER', name: $t('common.fde_engineer'), dataScope: 'OWN_RECORDS', builtin: true, status: 1 },
  { code: 'SALES', name: $t('common.sales'), dataScope: 'OWN_RECORDS', builtin: true, status: 1 }
]

function loadCached() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (Array.isArray(v) && v.length) return v
  } catch { /* ignore */ }
  return BUILTIN_ROLES
}

export const rolesRef = ref(loadCached())

/** 启用中的角色 (下拉用) */
export const activeRoles = computed(() => rolesRef.value.filter(r => r.status === 1))

/** 进后台/登录后调用, 刷新角色缓存 (失败静默, 用旧缓存/内置兜底) */
export async function refreshRoles() {
  const token = localStorage.getItem('fde_internal_token')
  if (!token) return null
  try {
    const res = await fetch('/api/fde/roles', { headers: { Authorization: 'Bearer ' + token } })
    const data = await res.json()
    if (data.code !== 0 || !Array.isArray(data.data?.list)) return null
    rolesRef.value = data.data.list
    localStorage.setItem(CACHE_KEY, JSON.stringify(data.data.list))
    return data.data.list
  } catch { return null }
}

// 内置角色的出厂名(任一语言): 库里还是出厂名就按界面语言翻译, 管理员改过名则原样显示
const BUILTIN_DEFAULT_NAMES = new Set(['系统管理员', '平台运营', '项目经理', 'FDE 工程师', '销售', ...BUILTIN_ROLES.map(r => r.name),
  'Administrator', 'Operations', 'Project Manager', 'FDE Engineer', 'Sales'])

/** 角色的展示名(内置角色未改名时随界面语言) */
export function roleDisplayName(role) {
  if (!role) return ''
  const builtin = BUILTIN_ROLES.find(r => r.code === role.code)
  if (builtin && (!role.name || BUILTIN_DEFAULT_NAMES.has(role.name))) return builtin.name
  return role.name || role.code
}

export function roleLabel(code) {
  if (!code) return ''
  const role = rolesRef.value.find(r => r.code === code)
  return role ? roleDisplayName(role) : (BUILTIN_ROLES.find(r => r.code === code)?.name || code)
}

// 内置角色沿用既有配色; 自定义角色按 code 哈希取色, 同角色永远同色
const BUILTIN_TAG_TYPE = {
  ADMIN: 'danger', PLATFORM: 'warning', MANAGER: 'primary',
  FDE_ENGINEER: 'success', SALES: 'info'
}
const PALETTE = ['primary', 'success', 'warning', 'danger', 'info']
export function roleTagType(code) {
  if (!code) return 'info'
  if (BUILTIN_TAG_TYPE[code]) return BUILTIN_TAG_TYPE[code]
  let h = 0
  for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export const DATA_SCOPE_LABELS = {
  ALL: $t('roles.all_data'),
  OWN_PROJECTS: $t('roles.projects_they_lead_or_join'),
  OWN_RECORDS: $t('roles.own_records_only')
}
