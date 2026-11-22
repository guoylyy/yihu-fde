// 0.5.0 侧栏导航: 一级 5 组(今日/团队/交付/经验/设置), 桌面侧栏与手机抽屉共用这一份。
// 纯函数: 传入权限判断, 返回过滤后的分组, 方便单测; 图标用名字, 由 AdminLayout 映射成组件。
//
// 可见性约定:
//   - 团队组: team.view(组长 + 老板); 周 OKR 仍只给 ADMIN
//   - 工时(0.5.2 放回, 团队组最后一项): timesheet.view; 任务上的「实际工时」仍是主入口, 工时页是按人按周汇总 + 报工/审批看板
//   - 「承诺 vs 交付」(team.view.all) 不单占菜单(业务二级菜单 ≤12 项), 从负载页顶部的切换进, 侧栏高亮负载
//   - 经验组的经验库/会话: can('projects') 兜底
//   - 资产库并在「经验库」里(页内切换), 路径仍是 /admin/assets, 侧栏高亮经验库

/** 分组 index 单一来源: 模板 :index 与默认展开都用它 */
export const NAV_GROUPS = { team: 'team', delivery: 'biz', experience: 'experience', config: 'base-config' }
export const DEFAULT_OPENEDS = Object.values(NAV_GROUPS)

/**
 * @param {object} ctx
 * @param {(perm: string) => boolean} ctx.can            菜单 key 或权限点
 * @param {(mod: string) => boolean} [ctx.moduleEnabled]
 * @param {string} [ctx.role]
 * @returns {{ key: string, index: string|null, title: string, items: { path: string, title: string, icon: string }[] }[]}
 *   index=null 的分组(今日)渲染成一级菜单项, 其余渲染成 el-sub-menu; 没有可见项的分组不返回
 */
export function buildNav({ can, moduleEnabled = () => true, role } = {}) {
  const isAdmin = role === 'ADMIN'
  const groups = [
    {
      key: 'today', index: null, title: 'nav.today',
      items: [{ path: '/admin/workbench', title: 'nav.my_today', icon: 'brand', show: true }]
    },
    {
      key: 'team', index: NAV_GROUPS.team, title: 'nav.team',
      items: [
        { path: '/admin/team/members', title: 'nav.team_members', icon: 'Avatar', show: can('team.view') },
        { path: '/admin/team/load', title: 'nav.team_load', icon: 'TrendCharts', show: can('team.view') },
        { path: '/admin/okr', title: 'okr.menu', icon: 'Aim', show: isAdmin && moduleEnabled('okr') },
        { path: '/admin/team/skills', title: 'nav.team_skills', icon: 'DataAnalysis', show: can('team.view') },
        { path: '/admin/timesheets', title: 'common.hours', icon: 'Timer', show: can('timesheet.view') }
      ]
    },
    {
      key: 'delivery', index: NAV_GROUPS.delivery, title: 'nav.delivery',
      items: [
        { path: '/admin/projects', title: 'common.projects', icon: 'Document', show: can('projects') },
        // OKR 4.0: 项目周 OKR 全员可读(写权限在页内判断)
        { path: '/admin/okr/projects', title: 'nav.project_okr', icon: 'Flag', show: moduleEnabled('okr') },
        { path: '/admin/okr/daily', title: 'nav.daily_summary', icon: 'Notebook', show: moduleEnabled('okr') },
        // OKR 9.0: 决策记录全员可读(写权限后端判)
        { path: '/admin/okr/decisions', title: 'nav.decisions', icon: 'Stamp', show: moduleEnabled('okr') },
        { path: '/admin/tasks', title: 'common.tasks', icon: 'List', show: can('project.view') || role === 'FDE_ENGINEER' },
        { path: '/admin/customers', title: 'common.customers', icon: 'User', show: can('customers') },
        { path: '/admin/knowledge', title: 'common.knowledge_base', icon: 'Reading', show: can('knowledge') },
        { path: '/admin/onboarding', title: 'common.developer_onboarding', icon: 'Guide', show: true }
      ]
    },
    {
      key: 'experience', index: NAV_GROUPS.experience, title: 'nav.experience',
      items: [
        { path: '/admin/ideas', title: 'common.ideas', icon: 'Opportunity', show: can('idea.view') },
        { path: '/admin/experience', title: 'nav.experience_library', icon: 'Collection', show: can('projects') },
        { path: '/admin/conversations', title: 'nav.conversations', icon: 'ChatLineSquare', show: can('projects') }
      ]
    },
    {
      key: 'config', index: NAV_GROUPS.config, title: 'nav.settings',
      items: [
        { path: '/admin/engineers', title: 'layout.engineer_management', icon: 'Avatar', show: can('engineers') },
        { path: '/admin/engineer-profiles', title: 'layout.skill_matrix', icon: 'DataAnalysis', show: can('engineers') },
        { path: '/admin/users', title: 'common.users', icon: 'UserFilled', show: can('users') },
        { path: '/admin/roles', title: 'common.roles', icon: 'Checked', show: can('role.manage') },
        { path: '/admin/teams', title: 'common.team_management', icon: 'OfficeBuilding', show: can('team.manage') },
        { path: '/admin/role-permissions', title: 'common.role_permissions', icon: 'Key', show: can('rolePermission.manage') },
        { path: '/admin/settings', title: 'systemSettings.title', icon: 'Setting', show: can('system.manage') }
      ]
    }
  ]
  return groups
    .map(g => ({ ...g, items: g.items.filter(i => i.show).map(({ show, ...i }) => i) }))
    .filter(g => g.items.length)
}

/**
 * 当前路由该高亮哪个菜单项: 详情页/子页落到所属列表; 资产库挂在经验库下。
 * 不在菜单里的页面原样返回, 不高亮任何项
 */
export function activeMenuPath(path) {
  const p = String(path || '')
  if (p === '/admin/assets' || p.startsWith('/admin/assets/')) {
    return '/admin/experience'
  }
  if (p === '/admin/team/promise') return '/admin/team/load'
  // 交付组里的 OKR 页先认, 免得被下面的 /admin/okr 前缀吃掉
  for (const pre of ['/admin/okr/projects', '/admin/okr/daily', '/admin/okr/decisions']) {
    if (p === pre || p.startsWith(pre + '/')) return pre
  }
  const prefixes = ['/admin/team/members', '/admin/projects', '/admin/knowledge', '/admin/conversations', '/admin/experience', '/admin/okr', '/admin/timesheets']
  for (const pre of prefixes) {
    if (p.startsWith(pre + '/')) return pre
  }
  return p
}
