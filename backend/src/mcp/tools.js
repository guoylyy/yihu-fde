// MCP 工具定义表（FDE 工程师智能体）
// 每个工具是对内部 REST API 的薄代理; 权限与数据范围由 API 层的角色/scopeWhere 控制
// 与 fde-agent-training/08-tool-definitions.json 保持同步
import { z } from 'zod'

const id = () => z.coerce.string().describe('数字 ID（字符串或数字均可）')
const date = (desc) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '格式 YYYY-MM-DD').describe(desc)
const page = { page: z.coerce.number().optional().describe('页码, 从 1 开始'), page_size: z.coerce.number().optional().describe('每页条数') }

/**
 * 工具定义: { name, description, schema(zod raw shape), build(args) => { method, path, query?, body? } }
 * build 返回 body 时按 JSON 发送; query 里的 undefined 会被剔除
 */
export const TOOLS = [
  // ============ 工作台 / 项目 ============
  {
    name: 'get_my_workbench',
    description: '获取当前工程师个人工作台：档案与技能、在职项目列表、本月工时汇总、待办任务。会话开始时先调用以获取 engineerId 和项目映射。',
    schema: {},
    build: () => ({ method: 'GET', path: '/api/fde/me' })
  },
  {
    name: 'get_engineer_profile',
    description: '读取工程师能力画像：近三月工时、交付完成率、验收首过率、项目类型与角色。仅基于已有记录计算，不替代经理评价。',
    schema: { engineerId: id().describe('工程师档案 id') },
    build: ({ engineerId }) => ({ method: 'GET', path: `/api/fde/engineer-profiles/${engineerId}` })
  },
  {
    name: 'suggest_engineers_for_task',
    description: '按项目类型、项目角色或技能从能力画像中排序推荐可派工工程师；只读建议，不自动指派任务。',
    schema: { projectType: z.string().optional(), role: z.string().optional(), skill: z.string().optional(), limit: z.coerce.number().optional() },
    build: (a) => ({ method: 'GET', path: '/api/fde/engineer-profiles/suggest', query: a })
  },
  {
    name: 'validate_decomposition_draft',
    description: '校验 AI 需求拆解草案：字段白名单、角色枚举、依赖存在性与循环依赖；只返回草案，不创建任务。',
    schema: { summary: z.string(), openQuestions: z.array(z.string()).optional(), milestones: z.array(z.object({ name: z.string(), tasks: z.array(z.object({ title: z.string(), role: z.enum(['PM', 'ARCHITECT', 'DEV', 'QA', 'FDE']), acceptanceCriteria: z.array(z.object({ acNo: z.string(), text: z.string(), level: z.enum(['L1_API', 'L2_UI', 'L3_STATIC']) })).optional(), dependencies: z.array(z.string()).optional() })) })) },
    build: (a) => ({ method: 'POST', path: '/api/fde/decomposition/validate', body: a })
  },
  {
    name: 'generate_decomposition_draft',
    description: '将需求文本交给 AI 生成待人工审核的结构化任务树草案(里程碑→任务→dependencies 依赖, 即一张路径图)；不创建任务、不改变项目数据。v2.8.0: 传 projectId(可选 milestoneId)会带上项目已有里程碑/任务作上下文, 不重复拆且能接上已有路径; 人工确认后用 apply_decomposition_draft 落库。',
    schema: { requirement: z.string().min(20).max(30000), projectId: id().optional(), milestoneId: id().optional().describe('目标里程碑: 任务全部拆到它下面') },
    build: (a) => ({ method: 'POST', path: '/api/fde/decomposition/generate', body: a })
  },
  {
    name: 'apply_decomposition_draft',
    description: 'v2.8.0 把审核过的拆解草案落库(一个事务): 建任务(source=AI)与 BLOCKS 依赖边, 传 milestoneId 则全部挂到该里程碑, 不传则按草案里程碑名匹配已有里程碑、没有就新建; 同时写一条项目记录留痕。草案有环/字段不合法整单拒绝不落任何数据。调用前必须把草案任务清单复述给用户并得到确认。',
    schema: {
      projectId: id(),
      milestoneId: id().optional().describe('目标里程碑 id; 不传按草案里程碑名匹配/新建'),
      draft: z.object({
        summary: z.string(), openQuestions: z.array(z.string()).optional(),
        milestones: z.array(z.object({
          name: z.string(), goal: z.string().optional(),
          tasks: z.array(z.object({
            title: z.string(), role: z.enum(['PM', 'ARCHITECT', 'DEV', 'QA', 'FDE']),
            description: z.string().optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(), estimateDays: z.coerce.number().optional(),
            acceptanceCriteria: z.array(z.object({ acNo: z.string(), text: z.string(), level: z.enum(['L1_API', 'L2_UI', 'L3_STATIC']) })).optional(),
            dependencies: z.array(z.string()).optional().describe('前置任务的完整标题(草案内或项目已有任务)')
          }))
        }))
      })
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/decomposition/apply', body: a })
  },
  {
    name: 'list_projects',
    description: '查询我参与的项目列表, 支持项目名/编号关键词搜索（用于把用户口述的项目名解析为 projectId）。v2.5.5(#915): 已关闭/已取消的归档项目默认不返回, 传 archived=true 只看归档, 或直接按 status 筛选。',
    schema: {
      keyword: z.string().optional().describe('项目名或编号关键词'),
      status: z.enum(['PROPOSAL', 'APPROVED', 'IN_PROGRESS', 'ACCEPTED', 'CLOSED', 'CANCELLED']).optional(),
      archived: z.enum(['true', 'false']).optional().describe('true=只看已关闭/已取消的归档项目'),
      ...page
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/projects', query: a })
  },
  {
    name: 'get_project_detail',
    description: '项目详情, 一次返回成员/里程碑/任务/工时/交付物/问题/风险。查进展或找 milestoneId、成员的 memberId 用。',
    schema: { projectId: id() },
    build: (a) => ({ method: 'GET', path: `/api/fde/projects/${a.projectId}` })
  },
  // ============ v2.1.12(#555) 项目-代码仓库关联 ============
  {
    name: 'list_project_repos',
    description: '查项目关联的代码仓库列表: {id, name, url, platform(gitee/github/gitlab), branch, lastSyncAt}。commit 带 #任务号 自动挂任务时间线的前提是仓库已在此登记。',
    schema: { projectId: id() },
    build: (a) => ({ method: 'GET', path: `/api/fde/projects/${a.projectId}/repositories` })
  },
  {
    name: 'add_project_repo',
    description: '给项目关联代码仓库(auto-dev 五通道之一)。只传 repoUrl 即可——name/platform/默认分支会自动从地址解析(Gitee/GitHub/GitLab), 也可显式覆盖。成功后项目 repoCount+1, 网页端项目主页「代码仓库」Tab 同步可见。需 project.edit 权限。',
    schema: {
      projectId: id(),
      repoUrl: z.string().min(1).describe('仓库地址(https:// 或 git@ 均可)'),
      name: z.string().optional().describe('仓库显示名, 缺省从地址解析'),
      defaultBranch: z.string().optional().describe('默认分支, 缺省从平台 API 解析(解析不到则空)'),
      description: z.string().optional()
    },
    build: (a) => ({
      method: 'POST', path: `/api/fde/projects/${a.projectId}/repositories`,
      body: { url: a.repoUrl, name: a.name, defaultBranch: a.defaultBranch, description: a.description }
    })
  },
  {
    name: 'remove_project_repo',
    description: '解除项目与代码仓库的关联(软删, repoCount-1)。repoId 从 list_project_repos 拿。解除后该仓库的提交不再同步到项目时间线——动手前确认没有在依赖它做提交关联。需 project.edit 权限。',
    schema: { projectId: id(), repoId: id().describe('仓库关联 id(list_project_repos 返回的 id)') },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/projects/${a.projectId}/repositories/${a.repoId}` })
  },
  {
    name: 'update_my_profile',
    description: '更新本人工程师档案: 技能标签/城市/简介/是否可派工。engineerId 用 get_my_workbench 拿到的本人 id —— 填别人的会 403。',
    schema: {
      engineerId: id().describe('本人的工程师档案 id'),
      skills: z.array(z.string()).optional().describe('技能标签数组'),
      city: z.string().optional().describe('常驻城市'),
      bio: z.string().optional().describe('个人简介'),
      available: z.coerce.number().optional().describe('1=可派工, 0=不可派工')
    },
    build: ({ engineerId, ...body }) => ({ method: 'PATCH', path: `/api/fde/engineers/${engineerId}`, body })
  },
  {
    name: 'list_customers',
    description: '查客户列表, 把用户口述的客户名解析成 customerId（create_project、线索转化都要用）。',
    schema: {
      keyword: z.string().optional().describe('客户名关键词'),
      industry: z.string().optional(),
      scale: z.string().optional().describe('客户规模'),
      ...page
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/customers', query: a })
  },
  {
    name: 'get_customer',
    description: '客户详情（含联系人）。要找对接人电话/邮箱、「XX 客户的联系人是谁」时用。',
    schema: { customerId: id() },
    build: (a) => ({ method: 'GET', path: `/api/fde/customers/${a.customerId}` })
  },
  // v2.1.6(#489): 联系人维护三件套 —— 评价触达的数据底座, PM/管理员可写(customer.edit)
  {
    name: 'add_customer_contact',
    description: '给客户新增联系人。手机号与邮箱至少填一个(评价发送依赖); isPrimary=true 设为主联系人(自动取消旧主)。需 customer.edit 权限。',
    schema: {
      customerId: id(),
      name: z.string().min(1).describe('联系人姓名'),
      title: z.string().optional().describe('职务'),
      phone: z.string().optional().describe('手机号'),
      email: z.string().optional().describe('邮箱'),
      isPrimary: z.coerce.boolean().optional().describe('是否主联系人'),
      notes: z.string().optional()
    },
    build: (a) => {
      const { customerId, isPrimary, ...body } = a
      return { method: 'POST', path: `/api/fde/customers/${customerId}/contacts`, body: { ...body, isPrimary: isPrimary ? 1 : 0 } }
    }
  },
  {
    name: 'update_customer_contact',
    description: '修改客户联系人(姓名/职务/电话/邮箱/主联系人)。name 必传(整体更新); contactId 从 get_customer 的 contacts 里取。',
    schema: {
      customerId: id(),
      contactId: id().describe('联系人 id'),
      name: z.string().min(1).describe('联系人姓名'),
      title: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      isPrimary: z.coerce.boolean().optional(),
      notes: z.string().optional()
    },
    build: (a) => {
      const { customerId, contactId, isPrimary, ...body } = a
      return { method: 'PUT', path: `/api/fde/customers/${customerId}/contacts/${contactId}`, body: { ...body, isPrimary: isPrimary ? 1 : 0 } }
    }
  },
  {
    name: 'delete_customer_contact',
    description: '删除客户联系人(软删，对接人离职、换人时)。删除动作必须拿到用户明确确认才调用, 不要顺手执行。',
    schema: { customerId: id(), contactId: id() },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/customers/${a.customerId}/contacts/${a.contactId}` })
  },
  {
    name: 'create_project',
    description: '新建项目。customerId 必填（先用 list_customers 把客户名解析成 id）; 项目编号由后端自动生成, 不用传。403 说明当前角色无 project.create 权限, 请用户找经理/管理员建。',
    schema: {
      name: z.string().min(1).describe('项目名称'),
      customerId: id().describe('所属客户 id'),
      type: z.string().optional().describe('项目类型'),
      managerId: id().optional().describe('项目经理的 userId'),
      startDate: date('开始日期').optional(),
      endDate: date('计划结束日期').optional(),
      budget: z.coerce.number().optional().describe('预算（元）'),
      description: z.string().optional()
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/projects', body: a })
  },
  {
    name: 'update_project',
    description: '更新项目信息/进度/健康度。health: GREEN正常 YELLOW有风险 RED严重滞后; progress 是 0-100 的整数。改健康度前先与用户确认依据（有什么问题/风险）, 不要凭感觉调。',
    schema: {
      projectId: id(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(['PROPOSAL', 'APPROVED', 'IN_PROGRESS', 'ACCEPTED', 'CLOSED', 'CANCELLED']).optional(),
      progress: z.coerce.number().min(0).max(100).optional().describe('完成百分比 0-100'),
      health: z.enum(['GREEN', 'YELLOW', 'RED']).optional(),
      managerId: id().optional().describe('项目经理 userId'),
      startDate: date('开始日期').optional(),
      endDate: date('计划结束日期').optional()
    },
    build: ({ projectId, ...body }) => ({ method: 'PUT', path: `/api/fde/projects/${projectId}`, body })
  },
  {
    name: 'add_project_member',
    description: '把人加进项目组。userId 从工作台或项目成员列表拿到（传 engineerId 也兼容）。roleInProject 必须显式给一个: PM项目经理/ARCHITECT架构/DEV开发/QA测试/FDE交付/OBSERVER观察/CLIENT客户方。',
    schema: {
      projectId: id(),
      userId: id().optional().describe('要加的人的 userId（与 engineerId 二选一）'),
      engineerId: id().optional().describe('工程师档案 id（与 userId 二选一）'),
      roleInProject: z.enum(['PM', 'ARCHITECT', 'DEV', 'QA', 'OBSERVER', 'FDE', 'CLIENT']).describe('在项目中的角色'),
      joinDate: date('加入日期').optional()
    },
    build: ({ projectId, ...body }) => ({ method: 'POST', path: `/api/fde/projects/${projectId}/members`, body })
  },
  {
    name: 'remove_project_member',
    description: '把人移出项目组。memberId 是「项目成员记录 id」, 不是 userId/engineerId —— 先调 get_project_detail 从 members 里取。',
    schema: { projectId: id(), memberId: id().describe('get_project_detail 的 members[].id') },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/projects/${a.projectId}/members/${a.memberId}` })
  },

  // ============ 里程碑 ============
  {
    name: 'list_milestones',
    description: '查项目的里程碑列表, 比 get_project_detail 更轻。状态: PENDING未开始 IN_PROGRESS进行中 COMPLETED已完成 DELAYED已延期。v2.1.2: 支持 keyword 按标题/描述搜索。',
    schema: {
      projectId: id(),
      status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED']).optional(),
      keyword: z.string().optional().describe('标题/描述关键词过滤')
    },
    build: ({ projectId, ...q }) => ({ method: 'GET', path: `/api/fde/projects/${projectId}/milestones`, query: q })
  },
  {
    name: 'create_milestone',
    description: '给项目加一个里程碑。plannedDate 是计划完成日期, 与用户确认后再建。排序自动追加到末尾。',
    schema: {
      projectId: id(),
      name: z.string().min(1).describe('里程碑名称'),
      description: z.string().optional(),
      plannedDate: date('计划完成日期').optional(),
      status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED']).optional().describe('默认 PENDING'),
      ownerId: id().optional().describe('里程碑负责人 userId (v1.9.3)'),
      goal: z.string().max(2000).optional().describe('v2.8.0 完成定义(一句话 DoD), 路径图终点节点上展示')
    },
    build: ({ projectId, ...body }) => ({ method: 'POST', path: `/api/fde/projects/${projectId}/milestones`, body })
  },
  {
    name: 'update_milestone',
    description: '改里程碑的名称/说明/计划日期/状态。想「关闭里程碑」用 close_milestone 更省事。',
    schema: {
      projectId: id(),
      milestoneId: id(),
      name: z.string().optional(),
      description: z.string().optional(),
      plannedDate: date('计划完成日期').optional(),
      status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED']).optional(),
      ownerId: id().optional().describe('里程碑负责人 userId (v1.9.3)'),
      goal: z.string().max(2000).optional().describe('v2.8.0 完成定义(一句话 DoD)')
    },
    build: ({ projectId, milestoneId, ...body }) => ({ method: 'PUT', path: `/api/fde/projects/${projectId}/milestones/${milestoneId}`, body })
  },
  {
    name: 'close_milestone',
    description: '关闭里程碑（置为 COMPLETED）。不传 actualDate 时后端自动填今天。关之前先跟用户确认这个里程碑确实交付完了。',
    schema: {
      projectId: id(),
      milestoneId: id(),
      actualDate: date('实际完成日期, 不传默认今天').optional()
    },
    build: ({ projectId, milestoneId, actualDate }) => ({
      method: 'PUT',
      path: `/api/fde/projects/${projectId}/milestones/${milestoneId}`,
      body: { status: 'COMPLETED', ...(actualDate ? { actualDate } : {}) }
    })
  },
  {
    name: 'delete_milestone',
    description: '删除里程碑（软删）。挂了任务/交付物的里程碑删了会留下悬空引用, 删之前先用 list_project_tasks 的 milestoneId 过滤确认没有在跟的任务。',
    schema: { projectId: id(), milestoneId: id() },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/projects/${a.projectId}/milestones/${a.milestoneId}` })
  },

  // ============ 工时 ============
  {
    name: 'create_timesheet',
    description: '填报一条工时（创建即提交, 等经理审批）。调用前必须与用户确认: 日期/项目/小时数/工作内容。一天=8小时, 半天=4小时。',
    schema: {
      projectId: id(),
      workDate: date('工作日期'),
      hours: z.coerce.number().gt(0).max(24).describe('小时数, 0.25 步进'),
      workContent: z.string().min(2).describe('具体工作内容, 不能笼统'),
      location: z.string().optional().describe("工作地点, 如'客户现场-上海', 出差建议填"),
      // v2.1.7(#492) 报工关联任务(强引导): 优先带 taskId; 确无任务时给 workCategory 作原因, 两者互斥
      taskId: id().optional().describe('关联任务 id(须属同项目), 报工尽量关联任务'),
      workCategory: z.enum(['ROUTINE', 'MEETING', 'OPS_SUPPORT', 'TRAINING']).optional().describe('无关联任务时的原因分类: ROUTINE日常事务/MEETING会议沟通/OPS_SUPPORT运维支持/TRAINING学习培训; 与 taskId 互斥')
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/timesheets', body: a })
  },
  {
    name: 'list_timesheets',
    description: '查询工时记录（日期区间/项目/工程师/状态过滤, 过滤在服务端生效不用拉全量）。工程师只能看自己的; 经理/管理员可见自己名下项目成员的工时——审批前先用 status=SUBMITTED 找待审批记录。状态: SUBMITTED=等审批 APPROVED=已通过 REJECTED=被驳回。',
    schema: {
      from: date('起始日期').optional(),
      to: date('结束日期').optional(),
      // v1.6.3(第三方反馈): 此前只认 snake_case, 驼峰传参被 zod 静默剥掉导致"过滤不生效"——现两种都收, 驼峰为主
      projectId: id().optional().describe('按项目过滤'),
      engineerId: id().optional().describe('按工程师过滤（审批场景查某人的待审工时）'),
      project_id: id().optional().describe('projectId 的旧名, 兼容保留'),
      engineer_id: id().optional().describe('engineerId 的旧名, 兼容保留'),
      status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
      offset: z.coerce.number().optional().describe('跳过条数, 与 page 二选一(offset 优先), 增量拉取用'),
      ...page
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/timesheets', query: a })
  },
  {
    name: 'update_timesheet',
    description: '修改一条未审批（SUBMITTED/REJECTED）的工时。已 APPROVED 的会失败, 需向用户解释找经理驳回。',
    schema: {
      timesheetId: id(),
      workDate: date('工作日期').optional(),
      hours: z.coerce.number().gt(0).max(24).optional(),
      workContent: z.string().optional(),
      location: z.string().optional(),
      taskId: id().optional().describe('关联任务 id(须属同项目)'),
      workCategory: z.enum(['ROUTINE', 'MEETING', 'OPS_SUPPORT', 'TRAINING']).optional().describe('无关联任务原因分类, 与 taskId 互斥')
    },
    build: ({ timesheetId, ...body }) => ({ method: 'PUT', path: `/api/fde/timesheets/${timesheetId}`, body })
  },
  {
    name: 'submit_timesheet',
    description: '提交一条草稿状态的工时进入审批（报工、提交工时、交工时）。',
    schema: { timesheetId: id() },
    build: (a) => ({ method: 'POST', path: `/api/fde/timesheets/${a.timesheetId}/submit` })
  },
  {
    name: 'approve_timesheet',
    description: '审批一条 SUBMITTED 状态的工时（批准或驳回）, 需经理/管理员权限。调用前必须与用户确认工时明细（谁/哪天/几小时/什么项目）和审批结论; 驳回时主动询问原因填入 reason。批量审批就逐条调用。403 表示当前用户无 timesheet.approve 权限, 请说明需经理/管理员操作。',
    schema: {
      timesheetId: id(),
      approved: z.boolean().describe('true=批准, false=驳回'),
      reason: z.string().optional().describe('驳回原因（驳回时建议填写, 会通知到工程师）')
    },
    build: ({ timesheetId, ...body }) => ({ method: 'POST', path: `/api/fde/timesheets/${timesheetId}/approve`, body })
  },

  // ============ 任务 ============
  {
    name: 'list_my_tasks',
    description: '查询分配给我的任务。默认只看我的（mine=true）。v2.1.10(#515): 自动开发/巡检模式默认只取 status=QUEUED（等候生产）的任务, TODO 是收件箱、未经 PM 排队不要自动开发; 人工挑任务时才列 TODO。',
    schema: {
      status: z.enum(['TODO', 'QUEUED', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'REWORK']).optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
      keyword: z.string().optional(),
      projectId: id().optional(),
      source: z.enum(['CUSTOMER', 'REVIEW', 'PATROL', 'SELF', 'none']).optional().describe('v2.1.13 按来源过滤: CUSTOMER客户需求/REVIEW评审/PATROL巡检/SELF自主发起; none=未标注'),
      ...page
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/tasks', query: { mine: 'true', ...a } })
  },
  {
    name: 'list_project_tasks',
    description: '查一个项目下的**全部**任务（经理视角, 不只是自己的）。可按负责人/里程碑/状态/优先级过滤。想只看自己的用 list_my_tasks。assigneeId 是工程师档案 id（get_project_detail 的 members[].engineer.id）, 不是 userId。v2.1.10(#515): 自动开发/巡检模式默认只取 status=QUEUED（等候生产）, TODO 收件箱任务仅在用户显式指定时处理, 无 QUEUED 任务不要拉 TODO 兜底。',
    schema: {
      projectId: id(),
      status: z.enum(['TODO', 'QUEUED', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'REWORK']).optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
      assigneeId: id().optional().describe('按负责人过滤, 传工程师档案 id'),
      keyword: z.string().optional(),
      archived: z.enum(['true', 'false']).optional().describe('true 只看已归档任务'),
      source: z.enum(['CUSTOMER', 'REVIEW', 'PATROL', 'SELF', 'none']).optional().describe('v2.1.13 按来源过滤: CUSTOMER客户需求/REVIEW评审/PATROL巡检/SELF自主发起; none=未标注'),
      ...page
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/tasks', query: a })
  },
  {
    name: 'get_task',
    description: '任务详情：描述(Markdown)/所属里程碑/负责人/附件列表(含评论附件)。查任务背景材料时先调这个。v2.7: 返回 suggestedAssets(按任务匹配到的可复用资产 top3, 含 loadHint), 有就先 get_asset 看看能不能直接复用。v2.8.0: 返回 predecessors/successors(上下游依赖)与 blocked/blockedBy —— blocked 为 true 说明前置还没完成, 开始前先看 get_milestone_roadmap。',
    schema: { taskId: id() },
    build: (a) => ({ method: 'GET', path: `/api/fde/tasks/${a.taskId}` })
  },
  {
    name: 'create_task',
    description: '创建任务。给自己建任务时 assigneeUserId 填工作台获取的本人 userId。可带 attachments（先用 upload_file 拿 url）。403 表示当前角色无 task.create 权限, 请用户找经理创建或让管理员在角色权限配置放开。',
    schema: {
      projectId: id(),
      title: z.string().min(1),
      description: z.string().optional().describe('支持 Markdown'),
      assigneeUserId: id().optional().describe('指派给谁(userId); 给自己建填本人 userId'),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
      dueDate: date('截止日期').optional(),
      milestoneId: id().optional(),
      source: z.enum(['CUSTOMER', 'REVIEW', 'PATROL', 'SELF']).optional().describe('v2.1.13 任务来源: CUSTOMER客户需求/REVIEW评审/PATROL巡检/SELF自主发起。给自己录入客户提的新需求填 CUSTOMER(计入识别增量需求); 巡检发现的问题填 PATROL; 评审产生的填 REVIEW; 自己主动发起的改进填 SELF'),
      dependsOn: z.array(id()).max(20).optional().describe('v2.8.0 路径图: 前置任务 id 列表(硬依赖 BLOCKS), 建任务顺手挂上; 事后补用 add_task_dependency'),
      attachments: z.array(z.object({
        filename: z.string(),
        fileUrl: z.string().describe('先用 upload_file 上传获取'),
        fileSize: z.coerce.number().optional()
      })).optional()
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/tasks', body: a })
  },
  // ============ v2.8.0(#1143) 里程碑路径图 ============
  {
    name: 'get_milestone_roadmap',
    description: 'v2.8.0 读整张里程碑路径图(AI 编程开工前先调这个): nodes(任务节点, 含 status/assignee/blocked/blockedBy/ready/predecessors/successors)、edges(BLOCKS 硬依赖 / FEEDBACK 回环软边)、topoOrder(拓扑序)、ready(前置都完成、现在就能开始的任务 id)、blocked(被挡住的)、terminals(终点)、criticalPath(关键路径与剩余天数)、mermaid(可直接渲染的流程图文本)、milestones[].stats(各里程碑 总/完成/可开始/阻塞)。不传 milestoneId 是整个项目一张图; 传 none 只看未挂里程碑的任务。取任务的原则: 从 ready 里按 priority 挑, 优先 criticalPath 上的。v2.9.0: 返回里多了 runs(taskId → 机器人运行摘要: status/progress/phase/agentName/stale) 与 dispatches(进行中的派工单)。',
    schema: { projectId: id(), milestoneId: z.string().optional().describe('里程碑 id; none=未挂里程碑; 不传=整个项目') },
    build: ({ projectId, milestoneId }) => ({ method: 'GET', path: `/api/fde/projects/${projectId}/roadmap`, query: { milestoneId } })
  },
  {
    name: 'add_task_dependency',
    description: 'v2.8.0 给两个任务建依赖边: predecessorId 是前置(先做), successorId 是后继(后做)。type=BLOCKS(默认, 硬依赖, 前置没完成后继就是阻塞态, 且不允许形成环 —— 成环会返回 9006 与环路, 别硬试, 改成 FEEDBACK 或调整方向) / FEEDBACK(回环软边, 表达"做完后继可能回到前置再迭代", 不参与阻塞)。两个任务必须在同一项目。重复建返回 9005。',
    schema: {
      predecessorId: id().describe('前置任务 id(先做的)'),
      successorId: id().describe('后继任务 id(后做的)'),
      type: z.enum(['BLOCKS', 'FEEDBACK']).optional().describe('默认 BLOCKS'),
      note: z.string().max(200).optional().describe('说明, 如"等接口文档"')
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/task-dependencies', body: a })
  },
  {
    name: 'remove_task_dependency',
    description: 'v2.8.0 删除两个任务之间的依赖边(按前置/后继 id 对定位, 不需要边 id)。',
    schema: { predecessorId: id(), successorId: id() },
    build: (a) => ({ method: 'DELETE', path: '/api/fde/task-dependencies/pair', query: a })
  },
  {
    name: 'update_task',
    description: '编辑任务的标题/描述/优先级/截止日期/里程碑/负责人（改状态用 update_task_status, 只换负责人用 assign_task 更直接）。v1.9.2 起支持 projectId 跨项目移动(评论/子任务随任务走, 未指定新里程碑时自动脱离旧里程碑)。',
    schema: {
      taskId: id(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
      dueDate: date('截止日期').optional(),
      milestoneId: id().optional(),
      assigneeUserId: id().optional().describe('改派给谁(userId)'),
      projectId: id().optional().describe('移动到哪个项目(跨项目移动)'),
      source: z.enum(['CUSTOMER', 'REVIEW', 'PATROL', 'SELF']).optional().describe('v2.1.13 任务来源标注: CUSTOMER客户需求/REVIEW评审/PATROL巡检/SELF自主发起'),
    },
    build: ({ taskId, ...body }) => ({ method: 'PUT', path: `/api/fde/tasks/${taskId}`, body })
  },
  {
    name: 'assign_task',
    description: '把任务改派给别人。assigneeUserId 是**用户 id**（工作台/项目成员里的 userId）, 不是工程师档案 id。改派前先与用户确认接手的人是谁, 对方会收到站内通知。',
    schema: { taskId: id(), assigneeUserId: id().describe('接手人的 userId') },
    build: (a) => ({ method: 'PUT', path: `/api/fde/tasks/${a.taskId}`, body: { assigneeUserId: a.assigneeUserId } })
  },
  {
    name: 'update_task_status',
    description: 'v1.9.7 五态流: TODO=收件箱→QUEUED=等候生产→IN_PROGRESS=生产中→DONE=生产完成。验收(VERIFIED)用 verify_task, 那是经理的动作。流转时间自动留痕。v2.0.1(#391): 转 QUEUED 计划起止改为可选。',
    schema: { taskId: id(), status: z.enum(['TODO', 'QUEUED', 'IN_PROGRESS', 'DONE']), plannedStartAt: date('计划开始(可选)').optional(), plannedEndAt: date('计划结束(可选)').optional() },
    build: ({ taskId, ...body }) => ({ method: 'POST', path: `/api/fde/tasks/${taskId}/status`, body })
  },
  {
    name: 'verify_task',
    description: '经理确认任务完成, 置为 VERIFIED（DONE → VERIFIED）。只有经理/管理员或任务负责人能改, 403 说明当前用户不是经理, 让用户转交。点之前先看 get_task 确认交付内容。v2.8.5 起自动验收体系已下线, 这是唯一的验收动作。',
    schema: { taskId: id() },
    build: (a) => ({ method: 'POST', path: `/api/fde/tasks/${a.taskId}/status`, body: { status: 'VERIFIED' } })
  },
  {
    name: 'delete_task',
    description: '删除任务（软删）。有子任务/评论/附件的一并失效, 是不可逆动作 —— 调用前必须与用户复述任务标题并得到明确确认。只是做完了就用 update_task_status 置 DONE, 别删。',
    schema: { taskId: id() },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/tasks/${a.taskId}` })
  },
  {
    name: 'add_task_attachment',
    description: '给任务挂附件（文件先用 upload_file 上传拿 url）。传 commentId 时挂到指定评论下。',
    schema: {
      taskId: id(),
      filename: z.string().describe('含扩展名的文件名'),
      fileUrl: z.string().describe('先用 upload_file 上传获取'),
      fileSize: z.coerce.number().optional(),
      commentId: id().optional().describe('评论附件时填')
    },
    build: ({ taskId, ...body }) => ({ method: 'POST', path: `/api/fde/tasks/${taskId}/attachments`, body })
  },
  {
    name: 'list_task_comments',
    description: '查看任务的评论串（含 @提及）。回答「这个任务大家说了什么」「任务讨论 / 留言」。',
    schema: { taskId: id() },
    build: (a) => ({ method: 'GET', path: '/api/fde/comments', query: { entity: 'task', entityId: a.taskId } })
  },
  {
    name: 'add_task_comment',
    description: '给任务发评论, 内容里 @姓名 会通知对应同事。返回的评论 id 可用于 add_task_attachment 挂评论附件。',
    schema: { taskId: id(), content: z.string().min(1) },
    build: (a) => ({ method: 'POST', path: '/api/fde/comments', body: { entity: 'task', entityId: a.taskId, content: a.content } })
  },
  {
    name: 'list_subtasks',
    description: '查看某任务的子任务清单（拆解、checklist、进度明细）。',
    schema: { taskId: id() },
    build: (a) => ({ method: 'GET', path: '/api/fde/subtasks', query: { taskId: a.taskId } })
  },
  {
    name: 'create_subtask',
    description: '给任务添加一个子任务（拆任务、加子项）。批量拆解时多次调用, order 递增。',
    schema: { taskId: id(), title: z.string().min(1), order: z.coerce.number().optional() },
    build: (a) => ({ method: 'POST', path: '/api/fde/subtasks', body: a })
  },
  {
    name: 'update_subtask',
    description: '勾选/取消勾选子任务完成（子任务做完了、打勾）, 或改标题。',
    schema: { subtaskId: id(), done: z.boolean().optional(), title: z.string().optional() },
    build: ({ subtaskId, ...body }) => ({ method: 'PUT', path: `/api/fde/subtasks/${subtaskId}`, body })
  },
  {
    name: 'delete_subtask',
    description: '删除一个子任务（拆错了才删; 做完了应该用 update_subtask 勾上 done）。',
    schema: { subtaskId: id() },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/subtasks/${a.subtaskId}` })
  },

  // ============ 问题 / 风险 ============
  {
    name: 'list_issues',
    description: '查项目的问题清单。想知道「这个项目还有哪些没解决的问题」就用 status=OPEN 或 IN_PROGRESS。severity: CRITICAL致命 HIGH高 MEDIUM中 LOW低。',
    schema: {
      projectId: id(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      ...page
    },
    build: ({ projectId, ...q }) => ({ method: 'GET', path: `/api/fde/projects/${projectId}/issues`, query: q })
  },
  {
    name: 'list_risks',
    description: '查项目的风险清单。status: IDENTIFIED已识别 MONITORING监控中 MITIGATED已缓解 CLOSED已关闭。做项目复盘/周报时先拉一遍。',
    schema: {
      projectId: id(),
      status: z.enum(['IDENTIFIED', 'MONITORING', 'MITIGATED', 'CLOSED']).optional(),
      ...page
    },
    build: ({ projectId, ...q }) => ({ method: 'GET', path: `/api/fde/projects/${projectId}/risks`, query: q })
  },
  {
    name: 'report_issue',
    description: '给项目登记一个问题。severity 根据影响判断, CRITICAL 需用户明确。若返回 403 表示需经理权限, 把整理好的问题描述给用户转交经理。',
    schema: {
      projectId: id(),
      title: z.string().min(2),
      description: z.string().optional().describe('复现步骤/影响范围'),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional()
    },
    build: ({ projectId, ...body }) => ({ method: 'POST', path: `/api/fde/projects/${projectId}/issues`, body })
  },
  {
    name: 'update_issue',
    description: '更新项目问题（issue、故障、待解决事项）的状态或内容（OPEN→IN_PROGRESS→RESOLVED→CLOSED）。',
    schema: {
      projectId: id(),
      issueId: id(),
      title: z.string().optional(),
      description: z.string().optional(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional()
    },
    build: ({ projectId, issueId, ...body }) => ({ method: 'PUT', path: `/api/fde/projects/${projectId}/issues/${issueId}`, body })
  },
  {
    name: 'report_risk',
    description: '给项目登记一个风险, 主动追问缓解措施填入 mitigation。403 处理同 report_issue。',
    schema: {
      projectId: id(),
      title: z.string().min(2),
      description: z.string().optional(),
      probability: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional().describe('发生概率'),
      impact: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional().describe('影响程度'),
      mitigation: z.string().optional().describe('缓解措施')
    },
    build: ({ projectId, ...body }) => ({ method: 'POST', path: `/api/fde/projects/${projectId}/risks`, body })
  },
  {
    name: 'update_risk',
    description: '更新项目风险的状态（IDENTIFIED→MONITORING→MITIGATED→CLOSED）或缓解措施（风险跟进、关闭风险）。',
    schema: {
      projectId: id(),
      riskId: id(),
      status: z.enum(['IDENTIFIED', 'MONITORING', 'MITIGATED', 'CLOSED']).optional(),
      mitigation: z.string().optional(),
      probability: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      impact: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional()
    },
    build: ({ projectId, riskId, ...body }) => ({ method: 'PUT', path: `/api/fde/projects/${projectId}/risks/${riskId}`, body })
  },
  {
    name: 'delete_issue',
    description: '删除误登的问题（软删）。问题解决了应该用 update_issue 置 RESOLVED/CLOSED 留痕, 只有"记错了/重复登记"才删。删前与用户确认。',
    schema: { projectId: id(), issueId: id() },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/projects/${a.projectId}/issues/${a.issueId}` })
  },
  {
    name: 'delete_risk',
    description: '删除误登的风险（软删）。风险不再存在应该用 update_risk 置 MITIGATED/CLOSED, 只有登错了才删。删前与用户确认。',
    schema: { projectId: id(), riskId: id() },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/projects/${a.projectId}/risks/${a.riskId}` })
  },

  // ============ 项目记录 (v1.4.x 过程资料; v1.6.0 +CHAT/RESEARCH) ============
  {
    name: 'add_project_record',
    description: '给项目沉淀一条过程记录: 会议纪要(MEETING)/对接沟通(COMM)/现场记录(SITE)/资料归档(FILE)/客户聊天记录(CHAT, 微信或飞书里与客户的往来对话)/研究记录(RESEARCH, 也可用更顺手的 add_research_note)/其他(OTHER)。content 用 Markdown 整理要点。带附件(照片/视频/文件)先用 upload_file 拿 url。开完会让用户口述, 你整理成结构化纪要后存入。默认仅内部可见。',
    schema: {
      projectId: id(),
      type: z.enum(['MEETING', 'COMM', 'SITE', 'FILE', 'CHAT', 'RESEARCH', 'OTHER']),
      title: z.string().min(1).describe("如'0724 客户需求评审会'"),
      content: z.string().optional().describe('Markdown 正文: 议题/结论/待办; CHAT 类型放整理后的对话原文'),
      occurredAt: z.string().optional().describe('发生时间 YYYY-MM-DD 或 ISO, 缺省当前'),
      attendees: z.string().optional().describe("参与人, 如'我方: 张工; 客户: 李经理'"),
      attachments: z.array(z.object({
        filename: z.string(),
        fileUrl: z.string().describe('先用 upload_file 上传获取'),
        fileSize: z.coerce.number().optional()
      })).optional()
    },
    build: ({ projectId, ...body }) => ({ method: 'POST', path: `/api/fde/project-records/${projectId}/records`, body })
  },
  {
    name: 'list_project_records',
    description: '查看项目的过程记录时间线(会议纪要/对接/现场记录/聊天记录/研究记录), 可按类型过滤。',
    schema: {
      projectId: id(),
      type: z.enum(['MEETING', 'COMM', 'SITE', 'FILE', 'CHAT', 'RESEARCH', 'OTHER']).optional(),
      ...page
    },
    build: ({ projectId, ...q }) => ({ method: 'GET', path: `/api/fde/project-records/${projectId}/records`, query: q })
  },

  // ============ Agent 协作回传 (v1.6.0: 干完活把过程资源沉淀回系统) ============
  {
    name: 'add_research_note',
    description: '归档一条研究记录到项目: 技术调研/方案比较/踩坑结论等。content 用 Markdown, 建议结构: ## 课题 / ## 结论 / ## 依据与参考链接。你替用户做完调研后主动问一句要不要归档, 同意即调。仅内部可见, 不会推给客户。',
    schema: {
      projectId: id(),
      title: z.string().min(1).describe("课题, 如'消息推送选型: 长连接 vs 轮询'"),
      content: z.string().min(1).describe('Markdown 正文: 课题/结论/依据与参考链接'),
      occurredAt: z.string().optional().describe('研究时间 YYYY-MM-DD, 缺省当前')
    },
    build: ({ projectId, ...body }) => ({
      method: 'POST',
      path: `/api/fde/project-records/${projectId}/records`,
      body: { ...body, type: 'RESEARCH' }
    })
  },
  {
    name: 'log_agent_conversation',
    description: '把你与用户的一段对话整段回传系统留存(项目过程资源, 团队可在项目时间线回看)。围绕某个项目的需求讨论/问题排查/决策过程值得留存时调用; 闲聊不要传。messages 按时间顺序给完整轮次。长对话分段传: 第一次不带 conversationId, 后续带着返回的 id 续写。默认仅内部可见。',
    schema: {
      conversationId: z.coerce.string().optional().describe('续写已回传的会话时带上(首次回传的返回值)'),
      title: z.string().optional().describe("会话主题, 如'报表导出超时问题排查'; 缺省取首条用户消息"),
      projectId: z.coerce.string().optional().describe('关联项目 id(强烈建议带上, 才会进项目时间线)'),
      customerId: z.coerce.string().optional().describe('关联客户 id(不带时随项目自动带出)'),
      messages: z.array(z.object({
        role: z.enum(['USER', 'ASSISTANT']),
        text: z.string().min(1),
        ts: z.string().optional().describe('该条消息时间 ISO 格式, 缺省当前')
      })).min(1).describe('对话轮次, 按时间顺序')
    },
    build: (body) => ({ method: 'POST', path: '/api/fde/agent-conversations/log', body })
  },
  {
    name: 'get_my_agent_profile',
    description: '查看当前 Key 对应的 Agent 注册档案(名称/平台/最近活跃/沉淀计数), 确认自己的身份。用个人 Key(非 Agent 专属 Key)调用时按主人维度返回其名下全部 Agent。',
    schema: {},
    build: () => ({ method: 'GET', path: '/api/fde/agent-profiles' })
  },
  // ============ v2.13.0 档案查询 (#1278) ============
  {
    name: 'list_my_agent_profiles',
    description: 'v2.13.0 列出我(当前用户)名下全部机器人档案(区别于 get_my_agent_profile 按单个 Key 查)。含已禁用(可再启用), 注销的不出现。返回 name/platform/machineName/purpose(巡检/派工/两用)/projectIds/model/status/statusLabel/lastActiveAt/lastActiveDaysAgo/isZombie。',
    schema: {},
    build: () => ({ method: 'GET', path: '/api/fde/agent-profiles/mine' })
  },
  {
    name: 'list_agent_profiles',
    description: 'v2.13.0 全平台机器人档案目录(仅 ADMIN, 非 ADMIN 返回 403)。支持 status(可逗号多选 1,0,-1)/ownerUserId/lastActiveFrom~lastActiveTo/zombie=true 筛选 + 分页, 默认最久未活跃的在前(僵尸优先)。返回含 owner 信息与 isZombie/lastActiveDaysAgo 派生字段。',
    schema: {
      status: z.string().optional().describe('状态筛选, 如 "1" 或 "0,-1"'),
      ownerUserId: id().optional().describe('按主人 userId 过滤'),
      lastActiveFrom: z.string().optional().describe('最近活跃起(ISO 时间)'),
      lastActiveTo: z.string().optional().describe('最近活跃止(ISO 时间)'),
      zombie: z.enum(['true', 'false']).optional().describe('true=只看僵尸(超过阈值天未活跃)'),
      ...page
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/agent-profiles/all', query: a })
  },
  // ============ v2.13.0 生命周期写接口 (#1279) ============
  {
    name: 'disable_agent_profile',
    description: 'v2.13.0 禁用机器人档案(status→0, 可逆)。其 API Key 即时失效(下次调用即 401)。运行中阻断: 有进行中的派工运行或 30 分钟内有巡检心跳 → 409 拒绝并给原因。档案主人或 ADMIN 可操作(越权 403)。恢复用 enable_agent_profile。',
    schema: {
      agentProfileId: id().describe('要禁用的档案 id(list_agent_profiles 可查)')
    },
    build: (a) => ({ method: 'POST', path: `/api/fde/agent-profiles/${a.agentProfileId}/disable`, body: {} })
  },
  {
    name: 'enable_agent_profile',
    description: 'v2.13.0 启用被禁用的机器人档案(status→1)。仅禁用态可启用; 启用后原 API Key 立即恢复可用。档案主人或 ADMIN 可操作。',
    schema: {
      agentProfileId: id().describe('要启用的档案 id')
    },
    build: (a) => ({ method: 'POST', path: `/api/fde/agent-profiles/${a.agentProfileId}/enable`, body: {} })
  },
  {
    name: 'deregister_agent_profile',
    description: 'v2.13.0 注销机器人档案(status→-1, 终态不可逆)。confirmName 必须与档案名完全一致(二次确认, 不一致 400 且状态不变); 名下 Key 全部物理吊销; 历史记录保留但档案不再出现在任何列表。运行中同样阻断(409)。档案主人或 ADMIN 可操作。**不可逆动作, 调用前与用户确认档案名**。',
    schema: {
      agentProfileId: id().describe('要注销的档案 id'),
      confirmName: z.string().describe('二次确认: 必须与档案名完全一致')
    },
    build: (a) => ({ method: 'POST', path: `/api/fde/agent-profiles/${a.agentProfileId}/deregister`, body: { confirmName: a.confirmName } })
  },
  {
    name: 'list_agent_profile_audits',
    description: 'v2.13.0 机器人档案生命周期审计日志(仅 ADMIN)。谁在何时对哪个档案执行了 disable/enable/deregister 及原因。支持 agentProfileId/operatorId/from~to 筛选 + 分页, 时间倒序。',
    schema: {
      agentProfileId: id().optional().describe('按档案过滤'),
      operatorId: id().optional().describe('按操作人 userId 过滤'),
      from: z.string().optional().describe('起始时间(ISO)'),
      to: z.string().optional().describe('结束时间(ISO)'),
      ...page
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/agent-profiles/audits', query: a })
  },


  // ============ 知识库 ============
  {
    name: 'search_knowledge',
    description: '知识库搜索（关键词/分类/项目/作者/标签/更新时间）。v2.5.5(#913): 结果默认不带正文, 带 summary/readMinutes, 读全文用 get_knowledge_article。',
    schema: {
      keyword: z.string().optional().describe('模糊匹配标题/分类/标签'),
      category: z.string().optional(),
      projectId: id().optional().describe('按项目过滤'),
      project_id: id().optional().describe('projectId 的旧名, 兼容保留'),
      authorId: id().optional().describe('按作者(userId)过滤'),
      tag: z.string().optional().describe('按单个标签精确过滤'),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('更新时间起(YYYY-MM-DD, 含)'),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('更新时间止(YYYY-MM-DD, 含)'),
      withContent: z.boolean().optional().describe('true 时列表项保留 Markdown 正文(旧行为)'),
      ...page
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/knowledge', query: a })
  },
  {
    name: 'get_knowledge_article',
    description: '读知识库文章全文（Markdown，经验、方案、文档）。先用 search_knowledge 搜到 articleId 再取。',
    schema: { articleId: id() },
    build: (a) => ({ method: 'GET', path: `/api/fde/knowledge/${a.articleId}` })
  },
  {
    name: 'create_knowledge_article',
    description: '发布知识库文章（content 为 Markdown）。建议先按 背景/现象/排查/解决/预防 起草给用户确认。',
    schema: {
      title: z.string().min(2),
      content: z.string().min(10).describe('Markdown 正文'),
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      projectId: id().optional()
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/knowledge', body: a })
  },
  {
    name: 'update_knowledge_article',
    description: '编辑知识库文章（修订文档、更新经验）; 传入的字段整体覆盖原值。内容过时优先修订而不是新建重复文章。',
    schema: {
      articleId: id(),
      title: z.string().optional(),
      content: z.string().optional(),
      category: z.string().optional(),
      tags: z.array(z.string()).optional()
    },
    build: ({ articleId, ...body }) => ({ method: 'PUT', path: `/api/fde/knowledge/${articleId}`, body })
  },
  {
    name: 'delete_knowledge_article',
    description: '删除知识库文章（软删）。内容过时应优先用 update_knowledge_article 修订而不是删。删前把标题复述给用户确认。',
    schema: { articleId: id() },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/knowledge/${a.articleId}` })
  },

  // ============ 通知 ============
  {
    name: 'list_notifications',
    description: '查我的站内通知（消息、提醒、有没有人找我）, unread=true 只看未读。',
    schema: { unread: z.enum(['true', 'false']).optional(), ...page },
    build: (a) => ({ method: 'GET', path: '/api/fde/notifications', query: a })
  },
  {
    name: 'mark_notification_read',
    description: '标记单条通知已读（消息已读，只能标记自己收到的）。',
    schema: { notificationId: id() },
    build: (a) => ({ method: 'POST', path: `/api/fde/notifications/${a.notificationId}/read` })
  },
  {
    name: 'mark_all_notifications_read',
    description: '把自己所有未读通知一次性标记为已读（消息全部已读、清空提醒）。',
    schema: {},
    build: () => ({ method: 'POST', path: '/api/fde/notifications/read-all' })
  },
  {
    name: 'delete_notification',
    description: '删掉自己收到的一条通知（删除消息）。只能删自己的, 删别人的会 403。',
    schema: { notificationId: id() },
    build: (a) => ({ method: 'DELETE', path: `/api/fde/notifications/${a.notificationId}` })
  },
  {
    name: 'send_notification',
    description: '给同事发一条**站内**通知（只进对方的站内信箱, 不会外发飞书或邮件 —— 对外通道一律要人在后台点）。收到的人会看到是谁发的。需经理/管理员权限, 403 就如实告诉用户。发之前必须把收件人和正文复述给用户确认, 不要替用户拟了就发。',
    schema: {
      toUserId: id().describe('接收人的 userId'),
      title: z.string().min(1).describe('通知标题'),
      content: z.string().optional().describe('正文'),
      link: z.string().optional().describe("站内跳转路径, 如 /admin/tasks/12")
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/notifications', body: a })
  },

  // ============ 汇总统计 / 周报 ============
  {
    name: 'get_timesheet_summary',
    description: '工时汇总统计, 做周报/月报的主力工具（不用再逐条拉工时自己加）。groupBy: PROJECT 按项目 / ENGINEER 按人 / DAY 按天 / TASK 按关联任务。缺省只统已审批通过的工时, 想含待审批的传 status=ALL。',
    schema: {
      from: date('起始日期').optional(),
      to: date('结束日期').optional(),
      groupBy: z.enum(['PROJECT', 'ENGINEER', 'DAY', 'TASK']).optional().describe('默认 PROJECT; TASK=按关联任务聚合(含「未关联」桶)'),
      projectId: id().optional().describe('只统某个项目'),
      status: z.enum(['APPROVED', 'SUBMITTED', 'DRAFT', 'REJECTED', 'ALL']).optional().describe('默认 APPROVED')
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/timesheets/_meta/summary', query: a })
  },
  {
    name: 'get_team_utilization',
    description: '团队投入统计: 各工程师在时间段内的已审批工时与记录条数, 按工时从多到少排。用来回答「这个月谁最忙/谁还有余量」。注意这是**工时投入**, 不含成本与薪酬数据。',
    schema: {
      from: date('起始日期'),
      to: date('结束日期'),
      projectId: id().optional().describe('只看某个项目里的投入'),
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/timesheets/_meta/summary', query: { ...a, groupBy: 'ENGINEER' } })
  },
  {
    name: 'list_teams',
    description: '查询组织团队目录(v1.5.6)。不传 teamId 返回启用中的团队清单(含负责人/成员数); 传 teamId 返回该团队详情与成员名单。回答「XX 属于哪个团队」「交付一组都有谁」用它。项目成员的所属团队 get_project_detail 已在 user.teams 直接带出, 不用再查。团队归属由管理员在后台设置, 智能体只能查不能改。',
    schema: { teamId: id().optional().describe('团队 id, 不传则列出全部启用中团队') },
    build: (a) => a.teamId
      ? ({ method: 'GET', path: `/api/fde/teams/${a.teamId}` })
      : ({ method: 'GET', path: '/api/fde/teams' })
  },


  // ============ v2.7 项目资产库 (#1140) ============
  // 资产 = 做好了、别的项目能直接拿走用的东西(代码/数据结构/界面/方案)。开发前先搜, 用上了登记复用。
  {
    name: 'search_assets',
    description: '搜索项目资产库(我们已经做好、可复用的能力: 项目框架/架构能力/业务能力, 如快递比价、报价规则引擎、微信套件)。**拆任务/开发前先搜一次**, 避免重复造轮子。传 taskId 时按任务标题+描述自动匹配(返回匹配分与命中词); 否则按关键词/层/成熟度/行业筛选。',
    schema: {
      taskId: id().optional().describe('按任务上下文自动匹配(优先)'),
      text: z.string().optional().describe('按一段需求文本匹配(与 taskId 可同时给)'),
      keyword: z.string().optional().describe('名称/说明/方案全文关键词'),
      layer: z.enum(['FRAMEWORK', 'ARCH', 'BIZ']).optional().describe('FRAMEWORK 项目框架 / ARCH 架构能力 / BIZ 业务能力'),
      maturity: z.enum(['L0', 'L1', 'L2', 'L3']).optional().describe('L0 线索 / L1 可参考 / L2 可复制(代码已抽离) / L3 可安装'),
      industry: z.string().optional().describe('行业精确匹配, 如 制造 / 教育 / 外贸'),
      limit: z.coerce.number().optional().describe('匹配模式返回条数, 默认 3'),
      ...page
    },
    build: ({ taskId, text, limit, ...q }) => (taskId || text)
      ? { method: 'GET', path: '/api/fde/assets/suggest', query: { taskId, text, limit: limit || 5 } }
      : { method: 'GET', path: '/api/fde/assets', query: q }
  },
  {
    name: 'get_asset',
    description: '读一个资产的全部内容: 方案 README、数据产物 ontology(业务对象/关系/动作)、出处(源项目/源仓库/关键文件)、资产仓库 目录(L2+)、关联的能力包与商城模块、复用记录。authorization=RESTRICTED 表示只能参考源码思路, 不得整段拷贝客户代码。',
    schema: { asset: z.string().describe('资产 id 或 slug, 如 express-quote') },
    build: ({ asset }) => ({ method: 'GET', path: `/api/fde/assets/${encodeURIComponent(asset)}` })
  },
  {
    name: 'record_asset_usage',
    description: '登记一次资产复用(资产库的生命线: 用它统计到底省了多少工时)。在任务里用上某个资产后调用。mode: REFERENCE 照着改 / COPY 拷目录 / INSTALL 安装; savedDays 为实际节省人天。',
    schema: {
      asset: z.string().describe('资产 id 或 slug'),
      projectId: id(),
      taskId: id().optional(),
      mode: z.enum(['REFERENCE', 'COPY', 'INSTALL']).optional(),
      savedDays: z.coerce.number().optional().describe('实际节省人天, 如 1.5'),
      feedback: z.string().optional().describe('好用吗/哪里要改, 帮资产升级')
    },
    build: ({ asset, ...body }) => ({ method: 'POST', path: `/api/fde/assets/${encodeURIComponent(asset)}/usages`, body })
  },
  {
    name: 'propose_asset',
    description: '登记一个候选资产(进草稿, 经理审核后发布)。发现某个做法/模块别的项目也能用时调用。L0 只需一句话+出处; 方案里客户名/域名/密钥必须换成占位符。',
    schema: {
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/, 'kebab-case').describe('如 express-tracking'),
      name: z.string(),
      summary: z.string().describe('一句话: 解决什么问题'),
      layer: z.enum(['FRAMEWORK', 'ARCH', 'BIZ']),
      keywords: z.array(z.string()).optional().describe('触发词含同义词'),
      techStack: z.array(z.string()).optional(),
      sourceProjectId: id().optional(),
      sourceRepo: z.string().optional(),
      sourcePaths: z.array(z.string()).optional().describe('关键文件路径'),
      readme: z.string().optional().describe('方案 Markdown(已脱敏)')
    },
    build: (body) => ({ method: 'POST', path: '/api/fde/assets', body: { maturity: 'L0', ...body } })
  },

  // ============ v2.9.0(#1162) 看板派工自动开发: 机器人侧 ============
  {
    name: 'claim_dev_run',
    description: 'v2.9.0 派工模式·领活。机器人(用专属 Key)每轮先调这个: 服务端在进行中的派工单里挑第一条 PENDING 且前置任务都完成的运行原子领取, 领取即把任务置 IN_PROGRESS, 返回 run(运行 id/尝试次数) + context(项目/里程碑完成定义/仓库/任务描述与子任务/上下游/派工备注/howto)。没活返回 run=null, 本轮结束即可(再去巡检 QUEUED 兜底)。手上已有未完成的运行会直接返回它(resumed=true), 一台机器一次只干一件。projectId 可选, 只领某项目的活。经理演练时可传 agentProfileId 代领。',
    schema: { projectId: id().optional(), agentProfileId: id().optional().describe('经理/管理员代某机器人领取(演练用); 机器人本身不用传') },
    build: (a) => ({ method: 'POST', path: '/api/fde/dev-dispatches/runs/claim', body: a })
  },
  {
    name: 'peek_dev_runs',
    description: 'v2.9.0 派工模式·探活(无副作用, 不领取): 返回 available=这台机器人现在能领的运行数(手上有未完成的也算 1)。机器人常驻循环每轮先调它, 为 0 就不用起完整会话; 人问「有活给机器人干吗」也可用。',
    schema: { projectId: id().optional(), agentProfileId: id().optional().describe('经理代查某机器人') },
    build: (a) => ({ method: 'GET', path: '/api/fde/dev-dispatches/runs/peek', query: a })
  },
  {
    name: 'report_dev_run_progress',
    description: 'v2.9.0 派工模式·进度上报(也是心跳)。每个阶段都报一次: phase 如 读任务/拆分/开发/自测/提交/回写, progress 0-99, message 一句话进展。超过 30 分钟不报会被看板标「失联」, 超过 2 小时会被释放给其他机器人。返回 409(code 9009) 说明运行已被取消/释放, 停手重新 claim。',
    schema: {
      runId: id(),
      progress: z.coerce.number().min(0).max(99).optional(),
      phase: z.string().max(40).optional(),
      message: z.string().max(500).optional(),
      level: z.enum(['INFO', 'WARN', 'ERROR']).optional(),
      data: z.record(z.any()).optional().describe('附加结构化数据, 如 {files: 3}')
    },
    build: ({ runId, ...body }) => ({ method: 'POST', path: `/api/fde/dev-dispatches/runs/${runId}/progress`, body })
  },
  {
    name: 'complete_dev_run',
    description: 'v2.9.0 派工模式·完成。任务置 DONE 并在任务评论写入摘要与提交清单; 派工单里全部运行到终态则派工单 DONE 并通知发起人。commits 请带 sha/url/message; 生产发布不是机器人的事, 做到本地验证+commit+push 即可。',
    schema: {
      runId: id(),
      summary: z.string().min(1).max(5000).describe('做了什么、怎么验证的、遗留项'),
      commits: z.array(z.object({ sha: z.string(), url: z.string().optional(), message: z.string().optional() })).optional(),
      branch: z.string().optional(),
      prUrl: z.string().optional(),
      testResult: z.string().max(2000).optional()
    },
    build: ({ runId, ...body }) => ({ method: 'POST', path: `/api/fde/dev-dispatches/runs/${runId}/complete`, body })
  },
  {
    name: 'fail_dev_run',
    description: 'v2.9.0 派工模式·放弃。说明做不了的原因; 任务回 QUEUED 等人处理, retryable=true 且尝试未满 3 次会自动重新排队。别硬做: 需求不清/缺权限/环境起不来都该 fail。',
    schema: { runId: id(), error: z.string().min(1).max(20000), retryable: z.boolean().optional() },
    build: ({ runId, ...body }) => ({ method: 'POST', path: `/api/fde/dev-dispatches/runs/${runId}/fail`, body })
  },
  {
    name: 'list_dev_dispatches',
    description: 'v2.9.0 看项目的派工单: 状态(RUNNING/PAUSED/DONE/CANCELLED)与运行计数。人问「机器人在干嘛/派工进展」时用; 想看单个任务的运行事件流看 get_milestone_roadmap 的 runs 字段。',
    schema: { projectId: id(), includeDone: z.enum(['true', 'false']).optional().describe('true 连已结束的一起列') },
    build: (a) => ({ method: 'GET', path: '/api/fde/dev-dispatches', query: a })
  },
  {
    name: 'create_dev_dispatch',
    description: 'v2.9.0 启动一张派工单(人在聊天里说「把 xx 里程碑派给机器人」时用, 调用前把范围复述给用户确认): scope=MILESTONE 里程碑全部未完成任务 / READY 只派现在可开始的 / TASKS 指定 taskIds; agentProfileId 指定机器人, 不传=任意在线机器人可领; note 是给机器人的约束。建即 RUNNING, 机器人下一轮 claim 就会领。',
    schema: { projectId: id(), milestoneId: id().optional(), scope: z.enum(['MILESTONE', 'READY', 'TASKS']).optional(), taskIds: z.array(id()).optional(), agentProfileId: id().optional(), title: z.string().max(200).optional(), note: z.string().max(5000).optional() },
    build: (a) => ({ method: 'POST', path: '/api/fde/dev-dispatches', body: a })
  },
  // ============ v2.10.0 创意中心 (#1180) ============
  // 想法与需求广场: 面向全公司, 不绑定项目。话题 → 想法 → 讨论 → 转成某个项目的里程碑, 再用路径图拆任务。
  {
    name: 'list_idea_topics',
    description: 'v2.10.0 创意中心: 列出全部话题(频道)与各自的想法数。发想法前先调它拿 topicId; archived=true 的话题不能再发新想法。',
    schema: {},
    build: () => ({ method: 'GET', path: '/api/fde/ideas/topics' })
  },
  {
    name: 'create_idea_topic',
    description: 'v2.10.0 创意中心: 开一个新话题。先 list_idea_topics 看有没有合适的, 没有再开; 同名会被拒绝。',
    schema: {
      name: z.string().min(1).max(60).describe('话题名称'),
      description: z.string().max(500).optional().describe('这个话题聊什么'),
      icon: z.string().max(20).optional().describe('一个 emoji')
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/ideas/topics', body: a })
  },
  {
    name: 'list_ideas',
    description: 'v2.10.0 创意中心: 列想法。可按话题/状态(OPEN 讨论中 / ADOPTED 已转里程碑 / PARKED 搁置 / ARCHIVED 已归档, v2.12.1 #1274)/关键词筛选; 默认不含已归档。sort: active 最近有动静(默认) / new 最新 / hot 最热; mine=true 只看我发的。返回摘要, 要全文与讨论用 get_idea。',
    schema: {
      topicId: id().optional(),
      status: z.enum(['OPEN', 'ADOPTED', 'PARKED', 'ARCHIVED']).optional(),
      keyword: z.string().optional().describe('标题/内容关键词'),
      mine: z.enum(['true', 'false']).optional(),
      sort: z.enum(['active', 'new', 'hot']).optional(),
      ...page
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/ideas', query: a })
  },
  {
    name: 'get_idea',
    description: 'v2.10.0 创意中心: 读一条想法的全文、全部讨论、AI 总结, 以及它被分配到了哪个项目的哪个里程碑。',
    schema: { ideaId: id() },
    build: ({ ideaId }) => ({ method: 'GET', path: `/api/fde/ideas/${ideaId}` })
  },
  {
    name: 'create_idea',
    description: 'v2.10.0 创意中心: 在某个话题下发一条想法(全公司可见)。content 支持 Markdown, 写清「是什么/为什么值得做/大概怎么做」; 内容里 @姓名 会通知对应同事。经 Agent 代发的会带标记。',
    schema: {
      topicId: id().describe('话题 id, 用 list_idea_topics 解析'),
      title: z.string().min(1).max(200),
      content: z.string().min(1).describe('支持 Markdown')
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/ideas', body: a })
  },
  {
    name: 'add_idea_comment',
    description: 'v2.10.0 创意中心: 在想法下发表评论; 传 parentId 是回复某条评论。内容里 @姓名 会通知对应同事。',
    schema: {
      ideaId: id(),
      content: z.string().min(1),
      parentId: id().optional().describe('回复哪条评论(get_idea 返回的 comments[].id)')
    },
    build: ({ ideaId, ...body }) => ({ method: 'POST', path: `/api/fde/ideas/${ideaId}/comments`, body })
  },
  {
    name: 'summarize_idea',
    description: 'v2.10.0 创意中心: 让 AI 把想法下的讨论收拢成结论(共识/分歧/待回答/建议下一步), 结果存在想法上, 所有人可见。讨论多了、要决定做不做之前调一次。未配置大模型会返回 4101。',
    schema: { ideaId: id() },
    build: ({ ideaId }) => ({ method: 'POST', path: `/api/fde/ideas/${ideaId}/ai-summary`, body: {} })
  },
  {
    name: 'draft_idea_milestone',
    description: 'v2.10.0 创意中心: 让 AI 把一条想法起草成里程碑(名称/完成定义/范围说明/动工前要问清的事)。只返回草稿不落库; 给 projectId 会参考该项目已有的里程碑避免重复。草稿给用户看过后再调 convert_idea_to_milestone。',
    schema: { ideaId: id(), projectId: id().optional().describe('打算分配到的项目') },
    build: ({ ideaId, ...body }) => ({ method: 'POST', path: `/api/fde/ideas/${ideaId}/ai-milestone-draft`, body })
  },
  {
    name: 'convert_idea_to_milestone',
    description: 'v2.10.0 创意中心: 把想法分配到一个项目, 形成里程碑(想法随之标记为已转里程碑, 作者会收到通知)。**调用前把项目、里程碑名称与完成定义复述给用户确认**。不传 milestoneId 是新建里程碑(name 缺省用想法标题); 传 milestoneId 是并入已有里程碑。转完后用 generate_decomposition_draft(带 projectId + milestoneId)继续拆任务。需要经理/管理员角色, 403 不要重试。',
    schema: {
      ideaId: id(),
      projectId: id().describe('分配到哪个项目'),
      milestoneId: id().optional().describe('并入已有里程碑时传'),
      name: z.string().max(200).optional().describe('新里程碑名称'),
      goal: z.string().max(2000).optional().describe('一句话完成定义'),
      description: z.string().optional().describe('范围说明, 支持 Markdown; 缺省用想法正文'),
      plannedDate: date('计划完成日期').optional(),
      ownerId: id().optional().describe('里程碑负责人 userId')
    },
    build: ({ ideaId, ...body }) => ({ method: 'POST', path: `/api/fde/ideas/${ideaId}/convert`, body })
  },
  // ============ v2.12 presence 读取出口 (#1253) ============
  {
    name: 'get_presence',
    description: '只读查询巡检 agent 的在线状态（谁在巡检/开发、在做什么任务、是否失联）。默认只返回活跃（30 分钟内有心跳）记录。管理角色可看全部并可按 agentProfileId/projectId 过滤；非管理角色只返回本凭证档案且不含 agentName/内部 activity。',
    schema: {
      projectId: id().optional().describe('按项目过滤'),
      agentProfileId: id().optional().describe('按指定 agent 过滤（仅管理角色）'),
      activeOnly: z.boolean().optional().describe('默认 true（只看活跃）；false 返回全部含历史'),
      staleMinutes: z.number().int().min(1).max(1440).optional().describe('失联阈值, 默认 30 分钟')
    },
    build: (a) => ({ method: 'GET', path: '/api/fde/agent-presence', query: a })
  },
  // ============ v2.0.9 Agent 巡检状态上报 (#435) ============
  {
    name: 'report_presence',
    description: '上报本 Agent 的巡检状态（心跳）。巡检每轮开始调用一次：projectId 传当前巡检项目（全局巡检不传），activity 一句话在干嘛。status: PATROLLING 巡检中 / IDLE 空闲 / OFFLINE 下线。重复上报刷新心跳（幂等）。v2.12(#1252) 起支持任务颗粒度：领到任务时带 taskId（+phase/progress 可选），任务完成/放弃时 taskId 传 null 清空；不带 taskId 的纯心跳调用仍兼容。',
    schema: {
      projectId: id().optional().describe('当前巡检的项目 id（全局巡检不传）'),
      status: z.enum(['PATROLLING', 'IDLE', 'OFFLINE']).optional().describe('默认 PATROLLING'),
      activity: z.string().max(300).optional().describe('一句话在干嘛'),
      taskId: id().nullable().optional().describe('当前正在开发的任务 id；null/空串=清空（任务完成或放弃时）；不传=保持原值'),
      phase: z.string().max(30).optional().describe('当前阶段，如 读代码/改代码/自测/写文档；需配合 taskId'),
      progress: z.number().int().min(0).max(99).nullable().optional().describe('进度 0-99；巡检无进度可不传（前端按「巡检中」渲染）')
    },
    build: (a) => ({ method: 'POST', path: '/api/fde/agent-presence', body: a })
  },

  // ============ 以虎 One 首页数据卡片(只读, 结果小; card: true 时返回 structuredContent 给平台卡片直接用) ============
  {
    name: 'get_my_open_task_count',
    card: true,
    description: '我手上还有几个没做完的任务（待办、等候生产、生产中的任务数）。回答「我还有几个任务」「待办多少」。返回 { total }，适合放首页数字卡片。',
    schema: {},
    build: () => ({ method: 'GET', path: '/api/fde/cards/my-open-task-count' })
  },
  {
    name: 'list_my_open_tasks',
    card: true,
    description: '我的待办任务清单（生产中的在前，再按截止日）：标题、项目、状态、截止日。回答「我今天做什么」「我的任务」「待办」。返回 { list }，适合放首页列表卡片；要筛选/分页用 list_my_tasks。',
    schema: { limit: z.number().int().min(1).max(20).optional().describe('最多几条，默认 8') },
    build: (a) => ({ method: 'GET', path: '/api/fde/cards/my-tasks', query: a })
  },
  {
    name: 'get_my_week_hours',
    card: true,
    description: '我本周报了多少工时（小时，不含已驳回）。回答「我这周报了多少工时」「本周工时」。返回 { total }，适合放首页数字卡片。',
    schema: {},
    build: () => ({ method: 'GET', path: '/api/fde/cards/my-week-hours' })
  },
  {
    name: 'list_my_weekly_hours',
    card: true,
    description: '我最近几周每周的工时（报工趋势）。返回 { list: [{ week, hours }] }，week 是周一日期；放首页折线卡片时 x = week、y = hours。',
    schema: { weeks: z.number().int().min(2).max(26).optional().describe('最近几周，默认 8') },
    build: (a) => ({ method: 'GET', path: '/api/fde/cards/my-hours-trend', query: a })
  },
  {
    name: 'list_pending_timesheet_approvals',
    card: true,
    description: '等我审批的工时（项目经理 / 管理员；范围是我能看到的项目）：谁、哪天、几小时、哪个项目。回答「有哪些工时待审批」「待我审批」。返回 { total, list }；没有审批权限返回空。审批用 approve_timesheet。',
    schema: { limit: z.number().int().min(1).max(20).optional().describe('最多几条，默认 8') },
    build: (a) => ({ method: 'GET', path: '/api/fde/cards/pending-approvals', query: a })
  },
  {
    name: 'list_project_health',
    card: true,
    description: '进行中项目的交付健康度（风险 / 关注 / 正常）和进度，有风险的在前。回答「哪些项目有风险」「项目健康度」「项目进展」。返回 { list }，适合放首页列表卡片。',
    schema: { limit: z.number().int().min(1).max(20).optional().describe('最多几条，默认 8') },
    build: (a) => ({ method: 'GET', path: '/api/fde/cards/project-health', query: a })
  },
  {
    name: 'list_overdue_tasks',
    card: true,
    description: '已过截止日还没完成的任务（我能看到的项目里），逾期最久的在前：标题、项目、截止日、逾期天数。回答「哪些任务逾期了」「延期任务」。返回 { list }。',
    schema: { limit: z.number().int().min(1).max(20).optional().describe('最多几条，默认 8') },
    build: (a) => ({ method: 'GET', path: '/api/fde/cards/overdue-tasks', query: a })
  }
]
