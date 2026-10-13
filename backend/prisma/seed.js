// Prisma seed script —— 内置角色 + 默认话题 + 一套演示数据
// 用法：node prisma/seed.js
// 幂等: 角色/话题/账号按唯一键 upsert, 演示项目已存在则跳过。
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { BUILTIN_ROLES } from '../src/lib/auth.js'

const prisma = new PrismaClient()

const ROLE_DESCRIPTIONS = {
  ADMIN: 'All permissions + user management',
  PLATFORM: 'Operations: global visibility across all business data',
  MANAGER: 'Manages projects; data limited to projects they lead or join',
  FDE_ENGINEER: 'Logs hours and works on tasks; data limited to own records',
  SALES: 'Customers and project kickoff; data limited to records they own'
}

const IDEA_TOPICS = [
  { name: 'Product ideas', description: 'New products or features worth discussing', icon: '💡' },
  { name: 'Customer needs', description: 'Requirements and pain points heard from customers', icon: '🎯' },
  { name: 'Process improvements', description: 'Where tooling, workflow or collaboration could be smoother', icon: '⚙️' }
]

const DEMO_PASSWORD = '123456'

async function upsertUser(username, name, role) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, passwordHash, name, email: `${username}@example.com`, role, status: 1 }
  })
}

async function main() {
  console.log('🌱 seeding...')

  // 1. 内置角色 (roles 表是角色清单的唯一权威源)
  for (const [i, r] of BUILTIN_ROLES.entries()) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: {},
      create: {
        code: r.code, name: r.name, description: ROLE_DESCRIPTIONS[r.code] || null,
        dataScope: r.dataScope, builtin: true, status: 1, sortOrder: i + 1
      }
    })
  }
  console.log(`  ✅ roles: ${BUILTIN_ROLES.length}`)

  // 2. 账号
  const admin = await upsertUser('admin', 'Admin', 'ADMIN')
  const manager = await upsertUser('manager', 'Morgan Lee', 'MANAGER')
  const fdeUser = await upsertUser('fde001', 'Sam Chen', 'FDE_ENGINEER')
  await upsertUser('sales', 'Alex Kim', 'SALES')
  const engineer = await prisma.engineer.upsert({
    where: { userId: fdeUser.id },
    update: {},
    create: {
      userId: fdeUser.id,
      level: 'SENIOR',
      skills: ['AI Agent', 'Node.js', 'Python', 'On-site delivery'],
      city: 'Remote',
      dailyRate: 2800.0,
      bio: 'Eight years of enterprise delivery; builds and ships AI agents with customers.',
      available: 1
    }
  })
  console.log('  ✅ users: admin / manager / fde001 / sales')

  // 3. 创意中心默认话题
  if (!(await prisma.ideaTopic.count())) {
    await prisma.ideaTopic.createMany({
      data: IDEA_TOPICS.map((t, i) => ({ ...t, sortOrder: i + 1, createdBy: admin.id }))
    })
    console.log(`  ✅ idea topics: ${IDEA_TOPICS.length}`)
  }

  // 4. 演示客户 + 项目
  const DEMO_CODE = 'DEMO-2026-0001'
  if (await prisma.project.findUnique({ where: { code: DEMO_CODE } })) {
    console.log('  ⏭  demo project exists, skipped')
  } else {
    const customer = await prisma.customer.create({
      data: {
        name: 'Acme Manufacturing Co.',
        shortName: 'Acme',
        industry: 'Manufacturing',
        scale: 'MEDIUM',
        tags: ['pilot'],
        status: 1,
        notes: 'Pilot customer: production management upgrade'
      }
    })
    await prisma.contact.create({
      data: { customerId: customer.id, name: 'Jordan Wang', title: 'IT Lead', phone: '13900000001', email: 'jordan@acme.example.com', isPrimary: 1 }
    })

    const project = await prisma.project.create({
      data: {
        code: DEMO_CODE,
        name: 'Acme production system upgrade',
        customerId: customer.id,
        type: 'UPGRADE',
        status: 'IN_PROGRESS',
        managerId: manager.id,
        startDate: new Date('2026-04-01'),
        endDate: new Date('2026-08-15'),
        budget: 280000.0,
        health: 'GREEN',
        progress: 60,
        description: 'Demo project: the full loop from idea to delivery.',
        createdBy: admin.id
      }
    })
    await prisma.projectMember.create({
      data: { projectId: project.id, engineerId: engineer.id, userId: fdeUser.id, roleInProject: 'LEAD', joinDate: new Date('2026-04-01') }
    })
    const milestones = [
      { name: 'M1 Discovery', plannedDate: new Date('2026-04-15'), status: 'COMPLETED', actualDate: new Date('2026-04-18'), sortOrder: 1 },
      { name: 'M2 Solution design', plannedDate: new Date('2026-05-01'), status: 'COMPLETED', actualDate: new Date('2026-05-03'), sortOrder: 2 },
      { name: 'M3 Build and deploy', plannedDate: new Date('2026-07-01'), status: 'IN_PROGRESS', sortOrder: 3 },
      { name: 'M4 Trial run and acceptance', plannedDate: new Date('2026-08-15'), status: 'PENDING', sortOrder: 4 }
    ]
    for (const m of milestones) await prisma.milestone.create({ data: { projectId: project.id, ...m } })
    await prisma.timesheet.create({
      data: {
        projectId: project.id,
        engineerId: engineer.id,
        workDate: new Date(new Date().toISOString().slice(0, 10)),
        hours: 8.0,
        workContent: 'Wired up backend routes, wrote the seed script, smoke-tested the full flow.',
        location: 'Remote',
        status: 'APPROVED',
        approvedBy: manager.id,
        approvedAt: new Date()
      }
    })
    console.log(`  ✅ demo project: ${project.code}`)
  }

  console.log('\n🎉 Seed done. Demo accounts (password 123456):')
  console.log('  admin (ADMIN) · manager (MANAGER) · fde001 (FDE_ENGINEER) · sales (SALES)')
}

main()
  .catch(e => {
    console.error('Seed FAIL:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
