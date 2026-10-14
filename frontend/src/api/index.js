import { withBase } from '../utils/base.js'
import { $t } from '../i18n/index.js'
import { ElMessage } from 'element-plus'
// FDE 平台 API helper
// 自动从 localStorage 读取 token 加 Authorization 头

function getInternalToken() {
  return localStorage.getItem('fde_internal_token') || ''
}

async function request(url, options = {}) {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  const headers = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  }
  if (getInternalToken() && !headers.Authorization) {
    headers.Authorization = 'Bearer ' + getInternalToken()
  }
  const timeout = options.timeout || 20000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  let res
  try {
    res = await fetch(url, { ...options, headers, signal: controller.signal })
  } catch (e) {
    clearTimeout(timer)
    // 2026-07-07 P2-2: fetch 失败（断网/CORS/超时）友好提示
    if (e.name === 'AbortError') {
      const err = new Error($t('common.request_timed_out_s_please_try', { p0: timeout / 1000 }))
      err.code = 'TIMEOUT'
      err.original = e
      throw err
    }
    const err = new Error($t('common.network_error_check_your_connection_try'))
    err.code = 'NETWORK'
    err.original = e
    throw err
  }
  clearTimeout(timer)
  const data = await res.json().catch(() => ({}))
  if (data.code !== 0) {
    // 2026-07-07 P2-2: 错误码映射为人类可读提示
    // v1.4.x bugfix: 各路由业务 code 与鉴权错误码撞号(如 1001='无工程师档案'),
    // 无条件按 code 映射会把真实错误吞成「未登录」。改为后端 message 优先,
    // 仅 HTTP 401/403(真鉴权失败)时用鉴权类文案兜底
    const friendly = {
      1001: $t('common.not_signed_in_please_sign_in'),
      1002: $t('common.session_expired_please_sign_in_again'),
      1003: $t('common.no_access_this_data_contact_administrator'),
      9001: $t('common.internal_server_error_please_try_again'),
      9002: $t('common.invalid_request_parameters'),
      9003: $t('common.you_dont_have_permission_for_this'),
      9004: $t('common.resource_doesnt_exist_or_was_deleted')
    }[data.code]
    // 401 是登录态问题, 用统一文案; 403 后端会说清楚缺什么权限、该找谁, 优先用后端的话
    const message = res.status === 401
      ? (friendly || data.message || $t('index.session_expired_please_sign_in_again'))
      : res.status === 403 ? (data.message || friendly) : (data.message || friendly || `HTTP ${res.status}`)
    const err = new Error(message)
    err.code = data.code
    err.data = data
    throw err
  }
  // 操作成功但有需要知道的事(如关闭里程碑时还有任务没做完)
  if (data._warn) ElMessage.warning({ message: data._warn, duration: 6000 })
  return data.data
}

// ============== FDE 内部 API ==============
export const fde = {
  customers: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/customers' + (q ? '?' + q : ''))
    },
    detail: (id) => request(`/api/fde/customers/${id}`),
    stats: () => request('/api/fde/customers/_meta/stats'),
    create: (data) => request('/api/fde/customers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/customers/${id}`, { method: 'DELETE' }),
    addContact: (id, data) => request(`/api/fde/customers/${id}/contacts`, { method: 'POST', body: JSON.stringify(data) }),
    updateContact: (customerId, contactId, data) => request(`/api/fde/customers/${customerId}/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeContact: (customerId, contactId) => request(`/api/fde/customers/${customerId}/contacts/${contactId}`, { method: 'DELETE' })
  },
  projects: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/projects' + (q ? '?' + q : ''))
    },
    detail: (id) => request(`/api/fde/projects/${id}`),
    update: (id, data) => request(`/api/fde/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    stats: (params = {}) => { const q = new URLSearchParams(params).toString(); return request('/api/fde/projects/_meta/stats' + (q ? '?' + q : '')) },   // v2.5.5(#914) 可按小组过滤
    create: (data) => request('/api/fde/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/projects/${id}`, { method: 'DELETE' }),
    addMember: (id, data) => request(`/api/fde/projects/${id}/members`, { method: 'POST', body: JSON.stringify(data) }),
    updateMember: (projectId, memberId, data) => request(`/api/fde/projects/${projectId}/members/${memberId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeMember: (projectId, memberId) => request(`/api/fde/projects/${projectId}/members/${memberId}`, { method: 'DELETE' }),
    pin: (id) => request(`/api/fde/projects/${id}/pin`, { method: 'PUT' }),   // v2.0.8(#422): 置顶/取消置顶(本人维度)
    // v2.5.5(#915) 关闭归档 / 恢复
    close: (id, reason) => request(`/api/fde/projects/${id}/close`, { method: 'POST', body: JSON.stringify({ reason: reason || '' }) }),
    reopen: (id) => request(`/api/fde/projects/${id}/reopen`, { method: 'POST', body: '{}' }),
    availableUsers: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/projects/_meta/available-users' + (q ? '?' + q : ''))
    },
    // 2026-07-03: 里程碑 CRUD
    // v1.9.3: 里程碑列表(任务/工时页筛选下拉用, 此前只能从项目详情整包捞)
    milestones: (projectId, params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/api/fde/projects/${projectId}/milestones` + (q ? '?' + q : ''))
    },
    createMilestone: (projectId, data) => request(`/api/fde/projects/${projectId}/milestones`, { method: 'POST', body: JSON.stringify(data) }),
    updateMilestone: (projectId, milestoneId, data) => request(`/api/fde/projects/${projectId}/milestones/${milestoneId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeMilestone: (projectId, milestoneId) => request(`/api/fde/projects/${projectId}/milestones/${milestoneId}`, { method: 'DELETE' }),
    // v2.8.0(#1143) 里程碑路径图聚合: params { milestoneId?: id | 'none' }
    roadmap: (projectId, params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/api/fde/projects/${projectId}/roadmap` + (q ? '?' + q : ''))
    },
    // 2026-07-09: 问题 (Issue) CRUD
    createIssue: (projectId, data) => request(`/api/fde/projects/${projectId}/issues`, { method: 'POST', body: JSON.stringify(data) }),
    updateIssue: (projectId, issueId, data) => request(`/api/fde/projects/${projectId}/issues/${issueId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeIssue: (projectId, issueId) => request(`/api/fde/projects/${projectId}/issues/${issueId}`, { method: 'DELETE' }),
    // 2026-07-09: 风险 (Risk) CRUD
    createRisk: (projectId, data) => request(`/api/fde/projects/${projectId}/risks`, { method: 'POST', body: JSON.stringify(data) }),
    updateRisk: (projectId, riskId, data) => request(`/api/fde/projects/${projectId}/risks/${riskId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeRisk: (projectId, riskId) => request(`/api/fde/projects/${projectId}/risks/${riskId}`, { method: 'DELETE' }),
    // 2026-07-09: 代码仓库 (Repository) CRUD
    parseRepo: (url) => request('/api/fde/projects/_meta/parse-repo', { method: 'POST', body: JSON.stringify({ url }) }),
    createRepo: (projectId, data) => request(`/api/fde/projects/${projectId}/repositories`, { method: 'POST', body: JSON.stringify(data) }),
    updateRepo: (projectId, repoId, data) => request(`/api/fde/projects/${projectId}/repositories/${repoId}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeRepo: (projectId, repoId) => request(`/api/fde/projects/${projectId}/repositories/${repoId}`, { method: 'DELETE' }),
    // 2026-07-20: 仓库提交动态
    // v2.0.5(#405): 进展驾驶舱聚合
    progressDashboard: (projectId, view) => request(`/api/fde/projects/${projectId}/progress-dashboard` + (view ? `?view=${view}` : '')),
    activities: (projectId, params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/api/fde/projects/${projectId}/activities` + (q ? '?' + q : ''))
    },
    syncRepos: (projectId) => request(`/api/fde/projects/${projectId}/repositories/sync`, { method: 'POST' })
  },
  engineers: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/engineers' + (q ? '?' + q : ''))
    },
    detail: (id) => request(`/api/fde/engineers/${id}`),
    create: (data) => request('/api/fde/engineers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/engineers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/engineers/${id}`, { method: 'DELETE' })
  },
  timesheets: {
    // v2.1.7(#495) 报工任务关联: 覆盖率观察与强制开关
    taskLinkConfig: () => request('/api/fde/timesheets/_meta/task-link-config'),
    setTaskLinkConfig: (requireTask) => request('/api/fde/timesheets/_meta/task-link-config', { method: 'PUT', body: JSON.stringify({ requireTask }) }),
    taskLinkCoverage: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/timesheets/_meta/task-link-coverage' + (q ? '?' + q : ''))
    },
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/timesheets' + (q ? '?' + q : ''))
    },
    // v1.9.4: 支持 projectId/groupBy(PROJECT|ENGINEER|DAY)/from/to/status 参数
    summary: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/timesheets/_meta/summary' + (q ? '?' + q : ''))
    },
    create: (data) => request('/api/fde/timesheets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/timesheets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/timesheets/${id}`, { method: 'DELETE' }),
    approve: (id, approved = true) => request(`/api/fde/timesheets/${id}/approve`, { method: 'POST', body: JSON.stringify({ approved }) }),
    submit: (id) => request(`/api/fde/timesheets/${id}/submit`, { method: 'POST' }),
    // v2.6.0(#959) 工作台一键提交本周草稿; 不传 ids 则后端按本周范围取本人草稿
    submitBatch: (ids = []) => request('/api/fde/timesheets/submit-batch', { method: 'POST', body: JSON.stringify({ ids }) }),
    pending: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/timesheets/_meta/pending' + (q ? '?' + q : ''))
    }
  },








  // v1.3.2 动态角色
  roles: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/roles' + (q ? '?' + q : ''))
    },
    create: (data) => request('/api/fde/roles', { method: 'POST', body: JSON.stringify(data) }),
    update: (code, data) => request(`/api/fde/roles/${code}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (code) => request(`/api/fde/roles/${code}`, { method: 'DELETE' })
  },
  // v1.5.6 团队管理 (一人可属多团队, 即时消息通知按团队定位)
  teams: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/teams' + (q ? '?' + q : ''))
    },
    detail: (id) => request(`/api/fde/teams/${id}`),
    update: (id, data) => request(`/api/fde/teams/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/teams/${id}`, { method: 'DELETE' })
  },
  // v1.4.x 项目记录(过程资料)
  projectRecords: {
    list: (projectId, params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/api/fde/project-records/${projectId}/records` + (q ? '?' + q : ''))
    },
    create: (projectId, data) => request(`/api/fde/project-records/${projectId}/records`, { method: 'POST', body: JSON.stringify(data) }),
    // 2026-07-31 会议纪要文档导入: 上传 md/docx/pdf, 大模型抽取字段返回草稿(耗时长, 单独超时)
    extract: (projectId, formData) => fetch(`/api/fde/project-records/${projectId}/records/extract`, {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': 'Bearer ' + getInternalToken() }
    }).then(async r => {
      const d = await r.json()
      if (d.code !== 0) throw new Error(d.message || $t('common.recognition_failed'))
      return d.data
    }),
    update: (id, data) => request(`/api/fde/project-records/records/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/project-records/records/${id}`, { method: 'DELETE' }),
    // v1.6.1 聊天记录导入: 粘贴文本(JSON)或上传导出文件(multipart), 规则解析成轮次预览
    parseChat: (projectId, text) => request(`/api/fde/project-records/${projectId}/records/parse-chat`, { method: 'POST', body: JSON.stringify({ text }) }),
    parseChatFile: (projectId, formData) => fetch(`/api/fde/project-records/${projectId}/records/parse-chat`, {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': 'Bearer ' + getInternalToken() }
    }).then(async r => {
      const d = await r.json()
      if (d.code !== 0) throw new Error(d.message || $t('common.parse_failed'))
      return d.data
    }),
    // v1.9.8(#350) 会议纪要→需求梳理: LLM 从纪要正文提炼需求(耗时长, 单独超时) + 需求清单 + 确认/驳回/编辑
    workflow: (projectId) => request(`/api/fde/project-records/${projectId}/workflow`),
    requirements: (projectId, params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/api/fde/project-records/${projectId}/requirements` + (q ? '?' + q : ''))
    },
    updateRequirement: (projectId, id, data) => request(`/api/fde/project-records/${projectId}/requirements/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    // v1.9.9(#351) 已确认需求一键生成任务/里程碑
    reqToTask: (projectId, id, data = {}) => request(`/api/fde/project-records/${projectId}/requirements/${id}/to-task`, { method: 'POST', body: JSON.stringify(data) }),
    reqToMilestone: (projectId, id, data = {}) => request(`/api/fde/project-records/${projectId}/requirements/${id}/to-milestone`, { method: 'POST', body: JSON.stringify(data) }),
    // v1.6.1 客户轴聚合: 客户名下所有项目的交互史(对接/聊天/会议 + Agent 对话)
    customerInteractions: (customerId, params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/api/fde/project-records/customer/${customerId}/interactions` + (q ? '?' + q : ''))
    }
  },
  uploads: {
    upload: (formData) => fetch('/api/fde/uploads', {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': 'Bearer ' + getInternalToken() }
    }).then(r => r.json())
  },
  knowledge: {
    checklist: (id) => request(`/api/fde/knowledge/checklists/${id}`),
    setChecklistItem: (id, key, checked) => request(`/api/fde/knowledge/checklists/${id}/${key}`, { method: 'PUT', body: JSON.stringify({ checked }) }),
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/knowledge' + (q ? '?' + q : ''))
    },
    detail: (id) => request(`/api/fde/knowledge/${id}`),
    create: (data) => request('/api/fde/knowledge', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/knowledge/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/knowledge/${id}`, { method: 'DELETE' }),
    view: (id) => request(`/api/fde/knowledge/${id}/view`, { method: 'POST', body: JSON.stringify({}) }),
    categories: () => request('/api/fde/knowledge/categories'),
    // v2.5.5(#913) 博客化: 作者/标签字典
    authors: () => request('/api/fde/knowledge/authors'),
    tags: () => request('/api/fde/knowledge/tags')
  },
  // v2.0.9(#428/#429): Skills 能力包(平台沉淀的 SKILL.md, Agent 经 MCP 共用)
  // v2.7(#1140) 项目资产库
  // v2.10.0(#1180) 创意中心: 话题 / 想法 / 讨论 / 转里程碑
  ideas: {
    topics: () => request('/api/fde/ideas/topics'),
    createTopic: (data) => request('/api/fde/ideas/topics', { method: 'POST', body: JSON.stringify(data) }),
    updateTopic: (id, data) => request(`/api/fde/ideas/topics/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeTopic: (id) => request(`/api/fde/ideas/topics/${id}`, { method: 'DELETE' }),
    list: (params = {}) => { const q = new URLSearchParams(params).toString(); return request('/api/fde/ideas' + (q ? '?' + q : '')) },
    detail: (id) => request(`/api/fde/ideas/${id}`),
    create: (data) => request('/api/fde/ideas', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/ideas/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/ideas/${id}`, { method: 'DELETE' }),
    // v2.12.1(#1274) 归档/恢复: 发布人或管理员
    archive: (id) => request(`/api/fde/ideas/${id}/archive`, { method: 'POST', body: '{}' }),
    unarchive: (id) => request(`/api/fde/ideas/${id}/unarchive`, { method: 'POST', body: '{}' }),
    batchArchive: (ideaIds) => request('/api/fde/ideas/batch-archive', { method: 'POST', body: JSON.stringify({ ideaIds }) }),
    like: (id) => request(`/api/fde/ideas/${id}/like`, { method: 'POST', body: '{}' }),
    addComment: (id, data) => request(`/api/fde/ideas/${id}/comments`, { method: 'POST', body: JSON.stringify(data) }),
    removeComment: (id, commentId) => request(`/api/fde/ideas/${id}/comments/${commentId}`, { method: 'DELETE' }),
    aiSummary: (id) => request(`/api/fde/ideas/${id}/ai-summary`, { method: 'POST', body: '{}', timeout: 120000 }),
    aiMilestoneDraft: (id, data = {}) => request(`/api/fde/ideas/${id}/ai-milestone-draft`, { method: 'POST', body: JSON.stringify(data), timeout: 120000 }),
    convert: (id, data) => request(`/api/fde/ideas/${id}/convert`, { method: 'POST', body: JSON.stringify(data) })
  },
  assets: {
    list: (params = {}) => { const q = new URLSearchParams(params).toString(); return request('/api/fde/assets' + (q ? '?' + q : '')) },
    meta: () => request('/api/fde/assets/meta'),
    detail: (idOrSlug) => request(`/api/fde/assets/${encodeURIComponent(idOrSlug)}`),
    create: (data) => request('/api/fde/assets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    publish: (id, force = false) => request(`/api/fde/assets/${id}/publish`, { method: 'POST', body: JSON.stringify({ force }) }),
    remove: (id) => request(`/api/fde/assets/${id}`, { method: 'DELETE' }),
    suggest: (params = {}) => { const q = new URLSearchParams(params).toString(); return request('/api/fde/assets/suggest' + (q ? '?' + q : '')) },
    addUsage: (id, data) => request(`/api/fde/assets/${id}/usages`, { method: 'POST', body: JSON.stringify(data) }),
    removeUsage: (id, usageId) => request(`/api/fde/assets/${id}/usages/${usageId}`, { method: 'DELETE' }),
    addLink: (id, data) => request(`/api/fde/assets/${id}/links`, { method: 'POST', body: JSON.stringify(data) }),
    removeLink: (id, linkId) => request(`/api/fde/assets/${id}/links/${linkId}`, { method: 'DELETE' }),
    addVersion: (id, data) => request(`/api/fde/assets/${id}/versions`, { method: 'POST', body: JSON.stringify(data) }),
    linkTargets: (params = {}) => { const q = new URLSearchParams(params).toString(); return request('/api/fde/assets/link-targets' + (q ? '?' + q : '')) },
    byProject: (projectId) => request(`/api/fde/assets/by-project/${projectId}`),
    draftFromProject: (projectId, data = {}) => request(`/api/fde/assets/draft-from-project/${projectId}`, { method: 'POST', body: JSON.stringify(data), timeout: 130000 })
  },
  // v2.0.9(#434): Agent 巡检状态(看板展示谁正在巡检)
  agentPresence: {
    active: () => request('/api/fde/agent-presence/active'),
    // v2.12.0(#1253) 只读列表(含 taskId/patrol), 可按项目过滤
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/agent-presence' + (q ? '?' + q : ''))
    }
  },
  users: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/users' + (q ? '?' + q : ''))
    },
    mentionable: () => request('/api/fde/users/mentionable'),
    detail: (id) => request(`/api/fde/users/${id}`),
    // 从以虎 One 通讯录选人提前开通: { platformUserId, role }
    create: (data) => request('/api/fde/users', { method: 'POST', body: JSON.stringify(data) }),
    platformDirectory: (keyword = '') => request('/api/fde/users/platform-directory?keyword=' + encodeURIComponent(keyword)),
    update: (id, data, query = {}) => {
      const q = new URLSearchParams(query).toString()
      return request(`/api/fde/users/${id}` + (q ? '?' + q : ''), { method: 'PUT', body: JSON.stringify(data) })
    },
    remove: (id) => request(`/api/fde/users/${id}`, { method: 'DELETE' })
  },
  // v2.0.0 开发上手中心 (#367)
  onboarding: {
    steps: () => request('/api/fde/onboarding/steps'),
    overview: () => request('/api/fde/onboarding/overview'),
    // 返回 zip blob, 前端触发下载 (签发新 Key, 旧配置包 Key 同时失效)
    downloadPackage: () => fetch('/api/fde/onboarding/package', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getInternalToken() }
    }).then(async r => {
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.message || $t('index.failed_generate_kit'))
      }
      return r.blob()
    })
  },
  me: () => request('/api/fde/me'),
  // v2.6.0(#959) 个人工作台: 首屏一把聚合 + 待办收件箱
  meWorkbench: () => request('/api/fde/me/workbench'),
  meTodos: (params = {}) => {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([_, v]) => v != null && v !== ''))).toString()
    return request('/api/fde/me/todos' + (q ? '?' + q : ''))
  },
  meWeeklyLeaderboard: () => request('/api/fde/me/weekly-leaderboard'),
  updateProfile: (data) => request('/api/fde/me/profile', { method: 'PUT', body: JSON.stringify(data) }),
  // FDE Training 培训模块 (v1.2.8)
  skills: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/skills' + (q ? '?' + q : ''))
    },
    create: (data) => request('/api/fde/skills', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/skills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/skills/${id}`, { method: 'DELETE' }),
    ofEngineer: (engineerId) => request(`/api/fde/skills/engineer/${engineerId}`),
    setEngineer: (engineerId, items) => request(`/api/fde/skills/engineer/${engineerId}`, { method: 'PUT', body: JSON.stringify({ items }) }),
    match: (skills) => request(`/api/fde/skills/match?skills=${encodeURIComponent(skills)}`)
  },
  engineerStats: (id, months = 6) => request(`/api/fde/engineer-stats/${id}?months=${months}`),
  engineerProfiles: {
    list: (params = {}) => { const q = new URLSearchParams(params).toString(); return request('/api/fde/engineer-profiles' + (q ? '?' + q : '')) },
    detail: (id) => request(`/api/fde/engineer-profiles/${id}`)
  },
  systemSettings: {
    get: () => request('/api/fde/system-settings'),
    update: (values) => request('/api/fde/system-settings', { method: 'PUT', body: JSON.stringify({ values }) })
  },
  llmConfigs: {
    list: () => request('/api/fde/llm-configs'),
    update: (id, data) => request(`/api/fde/llm-configs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    setDefault: (id) => request(`/api/fde/llm-configs/${id}/set-default`, { method: 'POST' }),
    remove: (id) => request(`/api/fde/llm-configs/${id}`, { method: 'DELETE' }),
    syncYihuOne: () => request('/api/fde/llm-configs/yihu-one/sync', { method: 'POST' })
  },
  // API Key（MCP/智能体对接凭证）
  apiKeys: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/api-keys' + (q ? '?' + q : ''))
    },
    update: (id, data) => request(`/api/fde/api-keys/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    revoke: (id) => request(`/api/fde/api-keys/${id}/revoke`, { method: 'POST' }),
    remove: (id) => request(`/api/fde/api-keys/${id}`, { method: 'DELETE' })
  },
  // 操作审计日志
  auditLogs: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/audit-logs' + (q ? '?' + q : ''))
    }
  },
  // 客户账单
  // 客户付款凭证审核
  // 客户 Portal 邀请码
  // 2026-07-20: 智能助手对话(历史落库); v1.6.0 会话可挂项目/客户, 第三方 Agent 回传 source=EXTERNAL
  agentConversations: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/agent-conversations' + (q ? '?' + q : ''))
    },
    create: (data = {}) => request('/api/fde/agent-conversations', { method: 'POST', body: JSON.stringify(data) }),
    detail: (id) => request(`/api/fde/agent-conversations/${id}`),
    messages: (id) => request(`/api/fde/agent-conversations/${id}/messages`),
    update: (id, data) => request(`/api/fde/agent-conversations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    byProject: (projectId) => request(`/api/fde/agent-conversations/project/${projectId}`),
    remove: (id) => request(`/api/fde/agent-conversations/${id}`, { method: 'DELETE' })
  },
  // v1.6.0 Agent 协作: 员工注册自己的 Agent(一体一专属 Key), 沉淀归属与目录
  agentProfiles: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/agent-profiles' + (q ? '?' + q : ''))
    },
    create: (data) => request('/api/fde/agent-profiles', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/agent-profiles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    rotateKey: (id) => request(`/api/fde/agent-profiles/${id}/rotate-key`, { method: 'POST' }),
    activities: (id, params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/api/fde/agent-profiles/${id}/activities` + (q ? '?' + q : ''))
    },
    remove: (id) => request(`/api/fde/agent-profiles/${id}`, { method: 'DELETE' }),
    // v2.13.0(#1281) 我的开发助手: 名下全部档案(含禁用/僵尸派生字段)
    mine: () => request('/api/fde/agent-profiles/mine'),
    // v2.13.0(#1282) 生命周期操作流
    disable: (id) => request(`/api/fde/agent-profiles/${id}/disable`, { method: 'POST', body: '{}' }),
    // v2.13.0(#1283) 管理端: 全量目录/审计/批量禁用
    all: (params = {}) => { const q = new URLSearchParams(params).toString(); return request('/api/fde/agent-profiles/all' + (q ? '?' + q : '')) },
    audits: (params = {}) => { const q = new URLSearchParams(params).toString(); return request('/api/fde/agent-profiles/audits' + (q ? '?' + q : '')) },
    batchDisable: (ids, reason) => request('/api/fde/agent-profiles/batch-disable', { method: 'POST', body: JSON.stringify({ agentProfileIds: ids, reason }) }),
    enable: (id) => request(`/api/fde/agent-profiles/${id}/enable`, { method: 'POST', body: '{}' }),
    deregister: (id, confirmName) => request(`/api/fde/agent-profiles/${id}/deregister`, { method: 'POST', body: JSON.stringify({ confirmName }) })
  },
  tasks: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/tasks' + (q ? '?' + q : ''))
    },
    get: (id) => request(`/api/fde/tasks/${id}`),
    create: (data) => request('/api/fde/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/tasks/${id}`, { method: 'DELETE' }),
    // v1.9.7(#353): 转 QUEUED 可随 status 一起带 plannedStartAt/plannedEndAt(YYYY-MM-DD)
    changeStatus: (id, status, extra = {}) => request(`/api/fde/tasks/${id}/status`, { method: 'POST', body: JSON.stringify({ status, ...extra }) }),
    archiveVerified: (projectId) => request('/api/fde/tasks/archive-verified', { method: 'POST', body: JSON.stringify({ projectId: projectId || undefined }) }),
    // v2.12.1(#1275) 批量验收 DONE → VERIFIED
    batchVerify: (taskIds) => request('/api/fde/tasks/batch-verify', { method: 'POST', body: JSON.stringify({ taskIds }) }),
    unarchive: (id) => request(`/api/fde/tasks/${id}/unarchive`, { method: 'POST', body: '{}' }),
    // v1.4.x 任务附件
    addAttachment: (id, data) => request(`/api/fde/tasks/${id}/attachments`, { method: 'POST', body: JSON.stringify(data) }),
    removeAttachment: (attId) => request(`/api/fde/tasks/attachments/${attId}`, { method: 'DELETE' }),
    // v2.12.0(#1261) 运行事件流（派工+巡检）
    runTimeline: (id) => request(`/api/fde/tasks/${id}/run-timeline`)
  },
  notifications: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/notifications' + (q ? '?' + q : ''))
    },
    unreadCount: () => request('/api/fde/notifications/unread-count'),
    markRead: (id) => request(`/api/fde/notifications/${id}/read`, { method: 'POST', body: '{}' }),
    readAll: () => request('/api/fde/notifications/read-all', { method: 'POST', body: '{}' }),
    remove: (id) => request(`/api/fde/notifications/${id}`, { method: 'DELETE' }),
    // v2.5.5(#912) 通知设置: 目录(分档/默认) + 我的按类型开关
    prefs: () => request('/api/fde/notifications/prefs'),
    savePrefs: (prefs) => request('/api/fde/notifications/prefs', { method: 'PUT', body: JSON.stringify({ prefs }) })
  },
  activities: {
    list: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request('/api/fde/activities' + (q ? '?' + q : ''))
    },
    recent: () => request('/api/fde/activities/recent'),
    // v2.12.0(#1261) 项目今日变化
    today: (projectId) => request(`/api/fde/activities/today?projectId=${projectId}`),
    remove: (id) => request(`/api/fde/activities/${id}`, { method: 'DELETE' })
  },
  comments: {
    list: (entity, entityId) => request(`/api/fde/comments?entity=${entity}&entityId=${entityId}`),
    create: (data) => request('/api/fde/comments', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/comments/${id}`, { method: 'DELETE' })
  },
  // v2.8.0(#1145) 路径图 AI 面板: 生成草案(带项目上下文) / 应用落库 / 补依赖建议 / 大白话解释
  decomposition: {
    generate: (data) => request('/api/fde/decomposition/generate', { method: 'POST', body: JSON.stringify(data), timeout: 180000 }),
    apply: (data) => request('/api/fde/decomposition/apply', { method: 'POST', body: JSON.stringify(data) }),
    suggestDependencies: (data) => request('/api/fde/decomposition/suggest-dependencies', { method: 'POST', body: JSON.stringify(data), timeout: 120000 }),
    explain: (data) => request('/api/fde/decomposition/explain', { method: 'POST', body: JSON.stringify(data), timeout: 120000 })
  },
  // v2.9.0(#1162) 看板派工: 派工单(人) + 运行(机器人)
  devDispatches: {
    list: (params = {}) => { const q = new URLSearchParams(params).toString(); return request('/api/fde/dev-dispatches' + (q ? '?' + q : '')) },
    robots: () => request('/api/fde/dev-dispatches/robots'),
    create: (data) => request('/api/fde/dev-dispatches', { method: 'POST', body: JSON.stringify(data) }),
    get: (id) => request(`/api/fde/dev-dispatches/${id}`),
    pause: (id) => request(`/api/fde/dev-dispatches/${id}/pause`, { method: 'POST', body: '{}' }),
    resume: (id) => request(`/api/fde/dev-dispatches/${id}/resume`, { method: 'POST', body: '{}' }),
    cancel: (id) => request(`/api/fde/dev-dispatches/${id}/cancel`, { method: 'POST', body: '{}' }),
    run: (runId, events = 50) => request(`/api/fde/dev-dispatches/runs/${runId}?events=${events}`),
    cancelRun: (runId) => request(`/api/fde/dev-dispatches/runs/${runId}/cancel`, { method: 'POST', body: '{}' }),
    redispatchRun: (runId) => request(`/api/fde/dev-dispatches/runs/${runId}/redispatch`, { method: 'POST', body: '{}' })
  },
  // v2.8.0(#1143) 任务依赖边(路径图): predecessor 前置 → successor 后继; type BLOCKS/FEEDBACK
  taskDependencies: {
    neighbors: (taskId) => request(`/api/fde/task-dependencies?taskId=${taskId}`),
    add: (data) => request('/api/fde/task-dependencies', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/task-dependencies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/task-dependencies/${id}`, { method: 'DELETE' })
  },
  subtasks: {
    list: (taskId) => request(`/api/fde/subtasks?taskId=${taskId}`),
    create: (data) => request('/api/fde/subtasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/api/fde/subtasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/api/fde/subtasks/${id}`, { method: 'DELETE' })
  },
  reports: {
    projects: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return '/api/fde/reports/projects/export' + (q ? '?' + q : '')
    },
    timesheets: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return '/api/fde/reports/timesheets/export' + (q ? '?' + q : '')
    },
    customers: () => '/api/fde/reports/customers/export'
  },
  // 角色权限配置 (2026-07-20)
  rolePermissions: {
    get: () => request('/api/fde/role-permissions'),
    mine: () => request('/api/fde/role-permissions/mine'),
    update: (changes) => request('/api/fde/role-permissions', { method: 'PUT', body: JSON.stringify({ changes }) }),
    reset: (permission) => request('/api/fde/role-permissions/reset', { method: 'POST', body: JSON.stringify(permission ? { permission } : {}) })
  },
}

// ============== 通用 ==============
export function logout() {
  localStorage.removeItem('fde_internal_token')
  localStorage.removeItem('fde_internal_user')
  if (location.pathname.startsWith(withBase('/admin'))) location.href = withBase('/admin/login')
}

export function formatMoney(v) {
  if (v === null || v === undefined) return '—'
  return '¥' + Number(v).toLocaleString('zh-CN')
}

export function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toISOString().slice(0, 10)
}
