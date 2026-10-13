// 官网「使用文档」目录(/docs)
//
// 扩充方式: 在本目录放一个 Markdown 文件 + 在下面登记一行, 完事。
// 文档随代码走 git, 不进数据库 —— 功能上线与文档更新天然同一个提交。
export const DOC_GROUPS = [
  {
    title: '员工上手',
    docs: [
      {
        slug: 'dev-workflow',
        title: '员工开发工作流：从零到交付',
        desc: 'v2.0.0：开会→需求→任务→开发→回写→报工时 全流程教程，含环境配置与 10 分钟跟练路径',
        load: () => import('./dev-workflow.md?raw')
      },
      {
        slug: 'auto-dev',
        title: '多项目自动开发模式：接入指南',
        desc: 'v2.0.6：五通道模型 + 接入清单 + CLAUDE.md 模板 + 巡检 prompt 模板 + 发布策略分级，把任何项目接入 AI 自动开发',
        load: () => import('./auto-dev.md?raw')
      },
      {
        slug: 'dev-robot',
        title: '开发机器人接入：看板派工自动开发',
        desc: 'v2.9.0：人在路径图上点派工、机器人按拓扑序领活、进度实时推回画布——建档拿 Key、配 MCP、起循环三步接入',
        load: () => import('./dev-robot.md?raw')
      },
      {
        slug: 'roadmap',
        title: '里程碑路径图：把任务的先后逻辑画出来',
        desc: 'v2.8.0：规划 Tab 任务 DAG 画布、硬依赖/回环、可开始/阻塞/关键路径口径、AI 生成→预览→应用、MCP 按图取任务',
        load: () => import('./roadmap.md?raw')
      },
      {
        slug: 'idea-plaza',
        title: '创意中心：想法从哪来，到哪去',
        desc: 'v2.10.0：面向全公司的想法与需求广场——开话题、发想法、讨论、AI 总结，再把想法分配到项目转成里程碑，接上路径图拆任务',
        load: () => import('./idea-plaza.md?raw')
      },
      {
        slug: 'asset-library',
        title: '资产沉淀与复用指南',
        desc: 'v2.7：做过的东西下一个项目直接拿来用——资产三层三产物、L0~L3 成熟度、开发前先搜、用上了登记复用、项目收尾 AI 起草、本体写法',
        load: () => import('./asset-library.md?raw')
      }
    ]
  },
  {
    title: '开发者',
    docs: [
      {
        slug: 'mcp',
        title: 'MCP 智能体接入',
        desc: '把支持 MCP 的智能体平台接入FDE 系统：端点、鉴权、工具清单',
        load: () => import('./mcp.md?raw')
      },,
      {
        slug: 'agent-collab',
        title: 'Agent 协作与数据沉淀',
        desc: 'v1.6.0：注册你的 Agent 拿专属 Key，让它把对话/研究/聊天记录沉淀回项目过程资料',
        load: () => import('./agent-collab.md?raw')
      }
    ]
  },
  {
    title: '接入教程',
    docs: [
      {
        slug: 'mcp-workbuddy',
        title: 'WorkBuddy 接入 MCP',
        desc: 'WorkBuddy 桌面端接入FDE 系统的配置步骤与排查',
        load: () => import('./mcp-workbuddy.md?raw')
      },
      {
        slug: 'mcp-openclaw',
        title: 'OpenClaw 接入 MCP',
        desc: 'OpenClaw 接入FDE 系统：CLI 一条命令或配置文件，含探活与排查',
        load: () => import('./mcp-openclaw.md?raw')
      },
    ]
  }
]

export const ALL_DOCS = DOC_GROUPS.flatMap(g => g.docs)
export const DEFAULT_SLUG = ALL_DOCS[0]?.slug

export function findDoc(slug) {
  return ALL_DOCS.find(d => d.slug === slug) || null
}
