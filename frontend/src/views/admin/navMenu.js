// 0.5.0 侧栏导航: 一级 5 组(今日/团队/交付/经验/设置), 桌面侧栏与手机抽屉共用这一份。
// 纯函数: 传入权限判断, 返回过滤后的分组, 方便单测; 图标用名字, 由 AdminLayout 映射成组件。
//
// 可见性约定(第 4 轮再细化到组长):
//   - 团队组: 暂时只给 ADMIN(组长可见留到第 4 轮)
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
        { path: '/admin/team/members', title: 'nav.team_members', icon: 'Avatar', show: isAdmin },
        { path: '/admin/team/load', title: 'nav.team_load', icon: 'TrendCharts', show: isAdmin },
        { path: '/admin/okr', title: 'okr.menu', icon: 'Aim', show: isAdmin && moduleEnabled('okr') },
        { path: '/admin/team/skills', title: 'nav.team_skills', icon: 'DataAnalysis', show: isAdmin }
      ]
    },
    {
      key: 'delivery', index: NAV_GROUPS.delivery, title: 'nav.delivery',
      items: [
        { path: '/admin/projects', title: 'common.projects', icon: 'Document', show: can('projects') },
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
 * 不在菜单里的页面(如 /admin/timesheets)原样返回, 不高亮任何项
 */
export function activeMenuPath(path) {
  const p = String(path || '')
  if (p === '/admin/assets' || p.startsWith('/admin/assets/')) {
    return '/admin/experience'
  }
  const prefixes = ['/admin/projects', '/admin/knowledge', '/admin/conversations', '/admin/experience', '/admin/okr']
  for (const pre of prefixes) {
    if (p.startsWith(pre + '/')) return pre
  }
  return p
}
