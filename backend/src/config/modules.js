// 功能模块登记表: 接口路径 → 模块码。版本开关(config/edition.js)按它决定哪些接口属于哪个模块。
// 前缀匹配(长的优先), 映射不到归 other(视为核心, 不受开关影响); 新增可开关的路由记得补。

export const MODULE_PREFIXES = [
  ['/api/fde/customers', 'customers'],
  ['/api/fde/project-records', 'project_records'],
  ['/api/fde/projects', 'projects'],
  ['/api/fde/engineer-stats', 'engineers'],
  ['/api/fde/engineer-profiles', 'engineers'],
  ['/api/fde/engineers', 'engineers'],
  ['/api/fde/skills', 'engineers'],
  ['/api/fde/skill-packages', 'engineers'],
  ['/api/fde/timesheets', 'timesheets'],
  ['/api/fde/reports', 'reports'],
  ['/api/fde/me', 'me'],
  ['/api/fde/onboarding', 'onboarding'],
  ['/api/fde/tasks', 'tasks'],
  ['/api/fde/subtasks', 'tasks'],
  ['/api/fde/task-dependencies', 'tasks'],
  ['/api/fde/dev-dispatches', 'tasks'],
  ['/api/fde/decomposition', 'tasks'],
  ['/api/fde/comments', 'tasks'],
  ['/api/fde/activities', 'tasks'],
  ['/api/fde/uploads', 'uploads'],
  ['/api/fde/knowledge', 'knowledge'],
  ['/api/fde/assets', 'assets'],
  ['/api/fde/ideas', 'ideas'],
  ['/api/fde/notifications', 'notifications'],
  ['/api/fde/agent-conversations', 'agent'],
  ['/api/fde/agent-profiles', 'agent'],
  ['/api/fde/agent-presence', 'agent'],
  ['/api/fde/users', 'admin'],
  ['/api/fde/teams', 'admin'],
  ['/api/fde/roles', 'admin'],
  ['/api/fde/role-permissions', 'admin'],
  ['/api/fde/audit-logs', 'admin'],
  ['/api/fde/api-keys', 'admin'],
  ['/api/fde/llm-configs', 'admin'],
  ['/api/fde/system-settings', 'admin'],
  ['/api/auth', 'auth'],
  ['/api/public', 'public']
].sort((a, b) => b[0].length - a[0].length)

export const MODULE_NAMES = {
  customers: 'Customers', projects: 'Projects', project_records: 'Project records',
  engineers: 'Engineers', timesheets: 'Timesheets', reports: 'Report export', me: 'Workbench',
  tasks: 'Tasks', uploads: 'Uploads', knowledge: 'Knowledge base', assets: 'Asset library', ideas: 'Ideas',
  notifications: 'Notifications', agent: 'Agents', onboarding: 'Developer onboarding',
  admin: 'Administration', auth: 'Authentication', public: 'Public endpoints', other: 'Other'
}

export function resolveModule(path) {
  for (const [prefix, code] of MODULE_PREFIXES) {
    if (path.startsWith(prefix)) return code
  }
  return 'other'
}
