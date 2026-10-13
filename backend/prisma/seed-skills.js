// Seed: 技能主数据 + 给 6 个 FDE 工程师挂技能
import prisma from '../src/lib/prisma.js'

const SKILLS = [
  // FRONTEND
  { name: 'Vue.js', category: 'FRONTEND', description: 'Vue 2/3 全家桶' },
  { name: 'React', category: 'FRONTEND', description: 'React + Hooks' },
  { name: 'TypeScript', category: 'FRONTEND', description: 'TS 类型系统' },
  { name: 'Element Plus', category: 'FRONTEND', description: 'Vue 3 UI 库' },
  { name: 'Vite', category: 'FRONTEND', description: '现代构建工具' },
  // BACKEND
  { name: 'Node.js', category: 'BACKEND', description: 'Node 运行时' },
  { name: 'Express', category: 'BACKEND', description: 'Node Web 框架' },
  { name: 'Java', category: 'BACKEND', description: 'Java SE/EE' },
  { name: 'Spring Boot', category: 'BACKEND', description: 'Java 主流框架' },
  { name: 'Python', category: 'BACKEND', description: 'Python 3' },
  { name: 'Django', category: 'BACKEND', description: 'Python Web 框架' },
  { name: 'Prisma', category: 'BACKEND', description: 'Node ORM' },
  // MOBILE
  { name: 'Flutter', category: 'MOBILE', description: '跨平台 UI 框架' },
  { name: 'iOS Swift', category: 'MOBILE', description: '原生 iOS' },
  { name: 'Android', category: 'MOBILE', description: '原生安卓' },
  // DEVOPS
  { name: 'Docker', category: 'DEVOPS', description: '容器化' },
  { name: 'Kubernetes', category: 'DEVOPS', description: '容器编排' },
  { name: 'Linux', category: 'DEVOPS', description: '服务器运维' },
  { name: 'Nginx', category: 'DEVOPS', description: '反向代理' },
  // DATA
  { name: 'MySQL', category: 'DATA', description: '关系数据库' },
  { name: 'PostgreSQL', category: 'DATA', description: '关系数据库' },
  { name: 'Redis', category: 'DATA', description: '缓存数据库' },
  { name: 'MongoDB', category: 'DATA', description: '文档数据库' },
  // PM
  { name: '需求分析', category: 'PM', description: '业务需求拆解' },
  { name: '项目管理', category: 'PM', description: '进度/风险/沟通' },
  { name: '客户沟通', category: 'PM', description: '客户关系维护' }
]

// 给每个工程师分配的技能（基于名字）
const ENG_SKILLS = {
  'fde001': [   // 高级工程师
    { name: 'Vue.js', level: 5, yearsExp: 4 },
    { name: 'TypeScript', level: 5, yearsExp: 3 },
    { name: 'Node.js', level: 4, yearsExp: 5 },
    { name: 'Prisma', level: 4, yearsExp: 2 },
    { name: 'MySQL', level: 4, yearsExp: 5 },
    { name: '项目管理', level: 4, yearsExp: 3 }
  ],
  'fde002': [   // 暂无档案（status=0 停用）
  ],
  'fde003': [   // 中级
    { name: 'React', level: 4, yearsExp: 3 },
    { name: 'TypeScript', level: 4, yearsExp: 2 },
    { name: 'Node.js', level: 3, yearsExp: 2 },
    { name: 'MySQL', level: 3, yearsExp: 3 }
  ],
  'fde004': [   // 高级
    { name: 'Java', level: 5, yearsExp: 6 },
    { name: 'Spring Boot', level: 5, yearsExp: 5 },
    { name: 'MySQL', level: 4, yearsExp: 6 },
    { name: 'Redis', level: 4, yearsExp: 4 },
    { name: 'Docker', level: 3, yearsExp: 2 }
  ],
  'fde005': [   // 专家
    { name: 'Java', level: 5, yearsExp: 8 },
    { name: 'Spring Boot', level: 5, yearsExp: 7 },
    { name: 'Kubernetes', level: 4, yearsExp: 4 },
    { name: 'Docker', level: 5, yearsExp: 6 },
    { name: 'PostgreSQL', level: 4, yearsExp: 5 },
    { name: '客户沟通', level: 4, yearsExp: 5 }
  ],
  'fde006': [   // 中级
    { name: 'Python', level: 4, yearsExp: 3 },
    { name: 'Django', level: 4, yearsExp: 2 },
    { name: 'Vue.js', level: 3, yearsExp: 2 },
    { name: 'MySQL', level: 3, yearsExp: 3 }
  ]
}

async function main() {
  console.log('🌱 技能 Seed 开始')

  // 1) 写入技能主数据
  for (const s of SKILLS) {
    await prisma.skill.upsert({
      where: { name: s.name },
      update: { category: s.category, description: s.description },
      create: s
    })
  }
  console.log(`  ✅ ${SKILLS.length} 个技能已写入`)

  // 2) 给工程师挂技能
  const skillsByName = await prisma.skill.findMany()
  const skillMap = new Map(skillsByName.map(s => [s.name, s]))

  for (const [username, items] of Object.entries(ENG_SKILLS)) {
    const engineer = await prisma.engineer.findFirst({
      where: { user: { username } }
    })
    if (!engineer) {
      console.log(`  ⚠️  工程师 ${username} 不存在，跳过`)
      continue
    }
    // 清旧关联
    await prisma.engineerSkill.deleteMany({ where: { engineerId: engineer.id } })
    // 写新关联
    for (const it of items) {
      const skill = skillMap.get(it.name)
      if (!skill) continue
      await prisma.engineerSkill.create({
        data: {
          engineerId: engineer.id,
          skillId: skill.id,
          level: it.level,
          yearsExp: it.yearsExp
        }
      })
    }
    // 同步冗余 skills JSON
    await prisma.engineer.update({
      where: { id: engineer.id },
      data: { skills: items.map(i => i.name) }
    })
    console.log(`  ✅ ${username}: ${items.length} 个技能`)
  }

  console.log('\n🎉 技能 Seed 完成！')
}

main()
  .catch(e => { console.error('Seed FAIL:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())