// 一次性 seed：创建一个内容完整的演示项目，用于验证项目主页
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function d(str) { return new Date(str) }

async function main() {
  const admin = await prisma.user.findUnique({ where: { username: 'admin' } })
  if (!admin) throw new Error('请先创建 admin 用户')

  // 一名工程师（用于成员 + 工时）
  const engUser = await prisma.user.upsert({
    where: { username: 'engineer1' },
    update: {},
    create: { username: 'engineer1', name: '张工', role: 'FDE_ENGINEER', status: 1, phone: '13800000001', email: 'zhang@example.com' }
  })
  const engineer = await prisma.engineer.upsert({
    where: { userId: engUser.id },
    update: {},
    create: { userId: engUser.id, level: 'SENIOR', city: '上海', dailyRate: 2000 }
  })

  // 客户
  const customer = await prisma.customer.create({
    data: { name: '示范科技有限公司', shortName: '示范科技', industry: '制造业', scale: 'LARGE', address: '上海市浦东新区' }
  })

  // 项目
  const project = await prisma.project.create({
    data: {
      code: 'PRJ-DEMO-001', name: 'AI 智能客服平台建设', customerId: customer.id, type: 'NEW',
      status: 'IN_PROGRESS', managerId: admin.id, startDate: d('2026-05-01'), endDate: d('2026-09-30'),
      budget: 800000, actualCost: 260000, health: 'YELLOW', progress: 45,
      description: '为客户搭建基于大模型的智能客服平台，涵盖知识库、多轮对话与工单系统。',
      createdBy: admin.id
    }
  })

  // 成员
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: admin.id, roleInProject: 'PM', joinDate: d('2026-05-01') },
      { projectId: project.id, engineerId: engineer.id, roleInProject: 'DEV', joinDate: d('2026-05-05') }
    ]
  })

  // 里程碑
  const [ms1, ms2] = await Promise.all([
    prisma.milestone.create({ data: { projectId: project.id, name: '需求调研与方案设计', plannedDate: d('2026-05-20'), actualDate: d('2026-05-22'), status: 'COMPLETED', sortOrder: 1, description: '完成业务调研、技术选型与整体架构设计。' } }),
    prisma.milestone.create({ data: { projectId: project.id, name: '核心对话引擎开发', plannedDate: d('2026-07-15'), status: 'IN_PROGRESS', sortOrder: 2, description: '多轮对话、知识库检索、意图识别。' } })
  ])
  await prisma.milestone.create({ data: { projectId: project.id, name: '试运行与验收', plannedDate: d('2026-09-20'), status: 'PENDING', sortOrder: 3 } })

  // 任务
  await prisma.task.createMany({
    data: [
      { projectId: project.id, milestoneId: ms1.id, title: '输出需求规格说明书', status: 'DONE', priority: 'HIGH', dueDate: d('2026-05-15'), completedAt: d('2026-05-14') },
      { projectId: project.id, milestoneId: ms2.id, title: '实现意图识别模块', status: 'IN_PROGRESS', priority: 'HIGH', dueDate: d('2026-07-10') },
      { projectId: project.id, milestoneId: ms2.id, title: '知识库向量化接入', status: 'TODO', priority: 'MEDIUM', dueDate: d('2026-07-12') }
    ]
  })

  // 工时
  await prisma.timesheet.createMany({
    data: [
      { projectId: project.id, engineerId: engineer.id, workDate: d('2026-07-01'), hours: 8, workContent: '对话引擎联调', status: 'APPROVED', approvedBy: admin.id },
      { projectId: project.id, engineerId: engineer.id, workDate: d('2026-07-02'), hours: 6.5, workContent: '意图识别模型训练', status: 'SUBMITTED' }
    ]
  })

  // 问题 & 风险
  await prisma.issue.create({ data: { projectId: project.id, title: '第三方大模型 API 限流影响联调', severity: 'HIGH', status: 'OPEN', description: '高峰期 API 调用被限流。', reporterId: admin.id } })
  await prisma.risk.create({ data: { projectId: project.id, title: '客户知识库数据交付延迟', probability: 'MEDIUM', impact: 'HIGH', status: 'MONITORING', mitigation: '提前对齐数据格式并分批交付。' } })

  console.log('✅ Demo 项目已创建: id=' + project.id + ' code=' + project.code)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
