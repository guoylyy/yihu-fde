// v2.0.9(#430): 现有 skills 迁移入库 —— 首批正式数据种子脚本
// 用法: node scripts/seed-skill-packages.mjs
// 幂等: 按 name upsert, 已存在则跳过(不覆盖人工编辑), 重复执行安全。
// 迁移后原调用路径不受影响: 配置包里的 SKILL.md 与本机 ~/.claude/skills 依旧按文件工作,
// 入库版本是「平台正本」, 供 Agent 经 MCP 检索加载与人工维护。
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import prisma from '../src/lib/prisma.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SEEDS = [
  {
    name: 'fde-tasks',
    displayName: 'FDE 任务工作流',
    category: 'dev-workflow',
    keywords: ['开工', '收工', '巡检', '拉任务', '回写任务'],
    // 正文从配置包模板取正本(与本机技能同源同步)
    contentFile: path.join(__dirname, '../src/templates/onboarding/SKILL.md'),
    description: 'FDE 平台任务驱动开发闭环：开工取任务 → 拆分 → 开发 → 收工回写，全程经 MCP 留痕。'
  },
  {
    name: 'auto-dev-patrol',
    displayName: '自动开发巡检',
    category: 'dev-workflow',
    keywords: ['巡检模式', '自动开发', '/loop'],
    status: 'DISABLED',
    // 正文内置(与官网教程第5节同源, 入库便于 Agent 直接取用)
    content: `---
name: auto-dev-patrol
description: 自动开发巡检。项目按 auto-dev 教程接入后, 用 /loop <间隔> <巡检prompt> 挂定时器, AI 每 N 分钟自动取任务开发。
---

# 自动开发巡检纪律

项目接入五通道(任务源/取任务/开发验证/发布/巡检驱动)后, 巡检轮附加纪律:

1. **安静轮**: 无符合条件任务时只回一句「巡检无任务」, 不展开汇报
2. **只动自己的活**: 仅处理「未指派」或「指派给我」的任务, 别人的任务不改状态
3. **发布按 CLAUDE.md 发布策略**: 自动上线项目走部署脚本+探活+更新记录; 「验收后上线」项目建「生产验收」任务等人点头, 不直接动生产
4. **连续多轮做不了的任务**(缺依赖/要拍板): 评论标注原因后跳过, 不每轮重复评论刷屏

巡检 prompt 参数化模板见 /docs/auto-dev 第 5 节。
`,
    description: '项目接入自动开发模式后的定时巡检纪律：安静轮、只动自己的活、发布按 CLAUDE.md 策略、跳过不刷屏。'
  }
]

async function main() {
  let created = 0, skipped = 0
  for (const seed of SEEDS) {
    const exists = await prisma.skillPackage.findFirst({ where: { name: seed.name, deletedAt: null } })
    if (exists) { skipped++; console.log(`  ⏭ ${seed.name} 已存在, 跳过(不覆盖人工编辑)`); continue }
    const content = seed.contentFile
      ? fs.readFileSync(seed.contentFile, 'utf8')
      : seed.content
    const pkg = await prisma.skillPackage.create({
      data: {
        name: seed.name,
        displayName: seed.displayName,
        description: seed.description,
        category: seed.category,
        keywords: seed.keywords,
        content,
        status: seed.status || 'ENABLED'
      }
    })
    created++
    console.log(`  ✅ ${pkg.name} (id=${String(pkg.id)}, status=${pkg.status})`)
  }
  console.log(`完成: 新建 ${created}, 跳过 ${skipped}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
