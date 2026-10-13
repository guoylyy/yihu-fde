// 项目编号生成 (v1.5.0 从 routes/fde/projects.js 抽出共享)
// 抽出原因: 方案确认后自动立项也要建项目, 必须与手工建项目用同一套编号规则,
// 否则库里会出现第三种项目编号格式
import prisma from '../lib/prisma.js'

/**
 * 生成下一个项目编号: {PROJECT_CODE_PREFIX}-{year}-{seq:4位补零}, 前缀默认 PRJ
 */
export async function nextProjectCode() {
  const year = new Date().getFullYear()
  const prefix = `${process.env.PROJECT_CODE_PREFIX || 'PRJ'}-${year}-`
  const last = await prisma.project.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' }
  })
  let seq = 1
  if (last) {
    const m = last.code.match(new RegExp(`^${prefix}(\\d+)$`))
    if (m) seq = Number(m[1]) + 1
  }
  return prefix + String(seq).padStart(4, '0')
}
