import { createRouter, createWebHistory } from 'vue-router'
import { BASE } from '@/utils/base.js'

const routes = [
  // 公开页只有使用文档; 其余非 /admin 的地址一律进后台(见下方守卫)
  { path: '/', redirect: '/admin' },
  // 周 OKR 的短地址(/okr 是默认页), 落到后台布局里
  { path: '/okr', redirect: to => ({ path: '/admin/okr', query: to.query }) },
  { path: '/okr/team', redirect: to => ({ path: '/admin/okr/team', query: to.query }) },
  { path: '/okr/history', redirect: to => ({ path: '/admin/okr/history', query: to.query }) },
  // 使用文档: 文档是仓库里的 Markdown, 加文档见 docs/manifest.js
  {
    path: '/docs/:slug?',
    name: 'Docs',
    component: () => import('@/views/DocsView.vue')
  },
  // ================== 管理后台 ==================
  {
    path: '/admin/login',
    name: 'AdminLogin',
    component: () => import('@/views/admin/AdminLogin.vue')
  },
  {
    path: '/admin',
    component: () => import('@/views/admin/AdminLayout.vue'),
    meta: { requiresInternalAuth: true },
    children: [
      // 主人拍板: 进系统先落自己的工作台(2026-07-31 的「默认项目管理」就此退役)
      { path: '', redirect: '/admin/workbench' },
      // 个人工作台: 登录后的默认落地页。不设权限点 —— 这里只有"我自己的事"
      // (后端 /api/fde/me/* 同样只要登录), 且它是越权访问的兜底目标, 加权限会把只读角色转晕
      { path: 'workbench', name: 'AdminWorkbench', component: () => import('@/views/admin/Workbench.vue') },
      // 0.5.0 团队组(R4): team.view = 组长 + 老板; 「承诺 vs 交付」只给老板(team.view.all)。
      // 工程师直达 → 守卫弹回今日页; 后端 /api/team/* 同样按这两个权限点拦
      { path: 'team/members', name: 'AdminTeamMembers', component: () => import('@/views/admin/team/TeamMembers.vue'),
        meta: { requiredPerm: 'team.view', requiredRoles: ['ADMIN', 'TEAM_LEAD'] } },
      { path: 'team/members/:engineerId(\\d+)', name: 'AdminTeamMemberDetail', component: () => import('@/views/admin/team/TeamMemberDetail.vue'),
        meta: { requiredPerm: 'team.view', requiredRoles: ['ADMIN', 'TEAM_LEAD'] } },
      { path: 'team/load', name: 'AdminTeamLoad', component: () => import('@/views/admin/team/TeamLoad.vue'),
        meta: { requiredPerm: 'team.view', requiredRoles: ['ADMIN', 'TEAM_LEAD'] } },
      { path: 'team/promise', name: 'AdminTeamPromise', component: () => import('@/views/admin/team/TeamPromise.vue'),
        meta: { requiredPerm: 'team.view.all', requiredRoles: ['ADMIN'] } },
      { path: 'team/skills', name: 'AdminTeamSkills', component: () => import('@/views/admin/team/TeamSkills.vue'),
        meta: { requiredPerm: 'team.view', requiredRoles: ['ADMIN', 'TEAM_LEAD'] } },
      // 0.5.0 经验组: 经验库 / 开发会话(后端按数据范围过滤, 前端先用 project.view 兜底)
      { path: 'experience', name: 'AdminExperience', component: () => import('@/views/admin/experience/Experience.vue'),
        meta: { requiredPerm: 'project.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      { path: 'conversations', name: 'AdminConversations', component: () => import('@/views/admin/conversations/Conversations.vue'),
        meta: { requiredPerm: 'project.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      { path: 'conversations/:id(\\d+)', name: 'AdminConversationDetail', component: () => import('@/views/admin/conversations/ConversationDetail.vue'),
        meta: { requiredPerm: 'project.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      // 周 OKR(公司管理级, 与项目管理无关)。OKR 2.0: 全员可看他人 O/KR, 团队页登录即可进
      // (后端按 ADMIN 全部 / 其他人本团队过滤, 主管评分只给本人与 ADMIN)
      { path: 'okr', name: 'AdminOkr', component: () => import('@/views/okr/MyOkr.vue') },
      { path: 'okr/history', name: 'AdminOkrHistory', component: () => import('@/views/okr/OkrHistory.vue') },
      { path: 'okr/team', name: 'AdminOkrTeam', component: () => import('@/views/okr/TeamOkr.vue') },
      { path: 'okr/person/:userId(\\d+)', name: 'AdminOkrPerson', component: () => import('@/views/okr/OkrPerson.vue') },
      { path: 'customers', name: 'AdminCustomers', component: () => import('@/views/admin/Customers.vue'),
        meta: { requiredPerm: 'customer.view', requiredRoles: ['ADMIN', 'MANAGER'] } },
      { path: 'projects', name: 'AdminProjects', component: () => import('@/views/admin/Projects.vue'),
        meta: { requiredPerm: 'project.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      // 项目模板库已下线, 旧入口跳项目列表
      { path: 'project-templates', redirect: '/admin/projects' },
      { path: 'projects/:id', name: 'AdminProjectDetail', component: () => import('@/views/admin/AdminProjectDetail.vue'),
        meta: { requiredPerm: 'project.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      { path: 'engineers', name: 'AdminEngineers', component: () => import('@/views/admin/Engineers.vue'),
        meta: { requiredPerm: 'engineer.view', requiredRoles: ['ADMIN', 'MANAGER'] } },
      { path: 'engineer-profiles', name: 'AdminEngineerProfiles', component: () => import('@/views/admin/EngineerProfiles.vue'),
        meta: { requiredPerm: 'engineer.view', requiredRoles: ['ADMIN', 'MANAGER'] } },
      // 0.5.0 工时降级成任务字段: 菜单已摘, 路由保留(旧链接不 404), 页内提示只剩历史记录
      { path: 'timesheets', name: 'AdminTimesheets', component: () => import('@/views/admin/Timesheets.vue'),
        meta: { requiredPerm: 'timesheet.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      // 交付物模块已下线, 旧入口跳项目列表
      { path: 'deliverables', redirect: '/admin/projects' },
      { path: 'knowledge', name: 'AdminKnowledge', component: () => import('@/views/admin/Knowledge.vue'),
        meta: { requiredPerm: 'knowledge.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      // v2.0.9(#429): Skills 能力包管理(交付模块内独立入口)
      // v2.10.0(#1180): 创意中心(想法与需求广场), 全员可进
      { path: 'ideas', name: 'AdminIdeas', component: () => import('@/views/admin/Ideas.vue'),
        meta: { requiredPerm: 'idea.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      // v2.7(#1140): 项目资产库
      { path: 'assets', name: 'AdminAssets', component: () => import('@/views/admin/Assets.vue'),
        meta: { requiredPerm: 'asset.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      { path: 'assets/:slug', name: 'AdminAssetDetail', component: () => import('@/views/admin/AssetDetail.vue'),
        meta: { requiredPerm: 'asset.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      { path: 'knowledge/edit/:id', name: 'AdminKnowledgeEdit', component: () => import('@/views/admin/KnowledgeEdit.vue'),
        meta: { requiredPerm: 'knowledge.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      // 知识库博客化: 独立阅读页(旧 ?open=<id> 在列表页自动跳转到这里)
      { path: 'knowledge/:id(\\d+)', name: 'AdminKnowledgeDetail', component: () => import('@/views/admin/KnowledgeDetail.vue'),
        meta: { requiredPerm: 'knowledge.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      { path: 'audit-logs', name: 'AdminAuditLogs', component: () => import('@/views/admin/AuditLogs.vue'),
        meta: { requiredPerm: 'audit.list', requiredRoles: ['ADMIN'] } },
      { path: 'users', name: 'AdminUsers', component: () => import('@/views/admin/Users.vue'),
        meta: { requiredPerm: 'user.view', requiredRoles: ['ADMIN'] } },
      { path: 'skills', name: 'AdminSkills', component: () => import('@/views/admin/Skills.vue'),
        meta: { requiredPerm: 'skill.manage', requiredRoles: ['ADMIN', 'MANAGER'] } },
      { path: 'profile', name: 'AdminProfile', component: () => import('@/views/admin/Profile.vue'),
        meta: { requiredPerm: 'me.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      // Agent 协作: 员工注册自己的 Agent(专属 Key), 所有内部角色可用; ADMIN 页内可切全员目录
      { path: 'agents', name: 'AdminAgentProfiles', component: () => import('@/views/admin/AgentProfiles.vue') },
      // 我的开发助手: 名下机器人一页管理
      { path: 'my-bots', name: 'AdminMyBots', component: () => import('@/views/admin/MyBots.vue') },
      // 开发上手中心(#367): 全员可见, 新员工五步走通标准开发工作流
      { path: 'onboarding', name: 'AdminOnboarding', component: () => import('@/views/admin/Onboarding.vue') },
      { path: 'tasks', name: 'AdminTasks', component: () => import('@/views/admin/Tasks.vue'),
        meta: { requiredPerm: 'task.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      // API Key 管理 (MCP/智能体对接凭证; FDE 工程师管理自己的, ADMIN 管理全部)
      { path: 'api-keys', name: 'AdminApiKeys', component: () => import('@/views/admin/ApiKeys.vue'),
        meta: { requiredPerm: 'apiKey.manage', requiredRoles: ['ADMIN', 'FDE_ENGINEER'] } },
      // 大模型配置 (基础模块, 仅 ADMIN)
      { path: 'settings', name: 'AdminSystemSettings', component: () => import('@/views/admin/SystemSettings.vue'),
        meta: { requiredPerm: 'system.manage', requiredRoles: ['ADMIN'] } },
      // 大模型配置已并入系统设置
      { path: 'llm-configs', redirect: { path: '/admin/settings', query: { tab: 'llm' } } },
      { path: 'notifications', name: 'AdminNotifications', component: () => import('@/views/admin/Notifications.vue'),
        meta: { requiredPerm: 'me.view', requiredRoles: ['ADMIN', 'MANAGER', 'FDE_ENGINEER'] } },
      // 基础配置 · 角色权限配置（仅 ADMIN, 与后端 rolePermission.manage 一致）
      { path: 'role-permissions', name: 'AdminRolePermissions', component: () => import('@/views/admin/RolePermissions.vue'),
        meta: { requiredPerm: 'rolePermission.manage', requiredRoles: ['ADMIN'] } },
      // 基础配置 · 角色管理（动态角色, 仅 ADMIN）
      { path: 'roles', name: 'AdminRoles', component: () => import('@/views/admin/Roles.vue'),
        meta: { requiredPerm: 'role.manage', requiredRoles: ['ADMIN'] } },
      // 基础配置 · 团队管理（一人可属多团队, 即时消息通知按团队定位接收人）
      { path: 'teams', name: 'AdminTeams', component: () => import('@/views/admin/Teams.vue'),
        meta: { requiredPerm: 'team.manage', requiredRoles: ['ADMIN'] } },
      // 一切未匹配的 /admin 子路径兜底回工作台, 不留白屏
      { path: ':pathMatch(.*)*', redirect: '/admin/workbench' }
    ]
  },
]

const router = createRouter({
  history: createWebHistory(BASE + '/'),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }

    return { top: 0 }
  }
})

/**
 * 全局路由守卫
 * - requiresInternalAuth: 需要内部账号登录 (fde_internal_token)
 * - requiredRoles: 允许访问的角色列表（未配则任何已登录用户可访问）
 */
import { resolveGuard, shouldRedirectToLogin } from './guards.js'
import { can } from '@/api/permissions.js'
router.beforeEach((to, from, next) => {
  // 没有公开前台: 除了后台和使用文档, 其余地址一律进后台登录
  if (shouldRedirectToLogin(to.path, false)) {
    return next({ path: '/admin/login' })
  }

  // 已停用的功能(meta.disabled): 直达 URL 一律跳回仪表盘
  if (to.matched.some(r => r.meta?.disabled)) {
    return next({ path: '/admin/workbench' })
  }

  // v1.3.0 还债: 原来读错 key(userInfo, 实际登录写的是 fde_internal_user),
  // 导致 requiredRoles 校验形同虚设; role 统一从 fde_internal_user 取
  const auth = {
    internalToken: localStorage.getItem('fde_internal_token'),
    role: (() => {
      try { return JSON.parse(localStorage.getItem('fde_internal_user') || 'null')?.role } catch { return undefined }
    })()
  }

  // v1.3.0: 声明了 requiredPerm 的路由按权限点判断(服务端生效权限, 后台可配), 其余回退 requiredRoles
  const result = resolveGuard(to.matched, auth, can)
  if (result === true) return next()
  // 补上 redirect query
  if (typeof result === 'object' && result.query?.redirect === 'protected') {
    result.query.redirect = to.fullPath
  }
  next(result)
})

export default router
