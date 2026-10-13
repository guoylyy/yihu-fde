// 仓库提交同步 (2026-07-20)
// 只同步「已配置到项目里」的 GitHub/Gitee/GitLab 仓库（ProjectRepository, 未删除），
// 增量拉取提交并落到 RepoActivity, 供项目主页时间线展示。整个 repo 不做全量扫描。
import prisma from '../lib/prisma.js'
import { fetchCommits, fetchBranches, SYNC_PROVIDERS } from '../lib/gitHost.js'

const MAX_BRANCHES = 50   // 单仓库最多扫描的分支数, 超出记 warn(避免超多分支的仓库拖垮同步)

// v1.9.1 任务↔提交关联(平台任务 #328): 提交信息里的 #taskId 引用
const TASK_REF_RE = /#(\d{1,10})/g

/**
 * v1.9.1: 提交信息带 #taskId 时, 自动在对应任务下生成关联评论(任务时间线可见)。
 * 只挂「本项目」的任务 —— 跨项目的数字引用(如外部 issue 编号)不误挂;
 * 幂等: 同一任务下已有含该 sha 短哈希的评论就跳过(提交跨分支/跨轮次重复出现时不刷屏)。
 * 评论作者记为首个 ADMIN(系统行为, 评论文案自带"自动关联"标识)。
 */
export async function linkCommitsToTasks(projectId, commits) {
  const refs = new Map()   // taskId(BigInt as string) -> commits[]
  for (const c of commits) {
    for (const m of String(c.title || '').matchAll(TASK_REF_RE)) {
      const key = m[1]
      if (!refs.has(key)) refs.set(key, [])
      refs.get(key).push(c)
    }
  }
  if (!refs.size) return 0
  const tasks = await prisma.task.findMany({
    where: { id: { in: [...refs.keys()].map(BigInt) }, projectId, deletedAt: null },
    select: { id: true }
  })
  if (!tasks.length) return 0
  const author = await prisma.user.findFirst({
    where: { role: 'ADMIN', deletedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true }
  })
  if (!author) return 0

  let linked = 0
  for (const t of tasks) {
    for (const c of refs.get(String(t.id))) {
      const short = String(c.sha || '').slice(0, 8)
      if (!short) continue
      const exists = await prisma.comment.findFirst({
        where: { entity: 'task', entityId: t.id, deletedAt: null, content: { contains: short } },
        select: { id: true }
      })
      if (exists) continue
      await prisma.comment.create({
        data: {
          entity: 'task',
          entityId: t.id,
          authorId: author.id,
          content: `🔗 自动关联提交 ${short}${c.author ? `（${c.author}）` : ''}: ${String(c.title || '').slice(0, 300)}${c.url ? `\n${c.url}` : ''}`
        }
      })
      linked++
    }
  }
  return linked
}

// 分支排序权重: 主干分支(默认分支/master/main)排最前, 其余保持原序
function rankBranch(name, mainFirst) {
  const i = mainFirst.indexOf(name)
  return i >= 0 ? i : mainFirst.length + 1
}

/**
 * 同步单个 ProjectRepository 的提交。
 * 跨「所有分支」聚合最新提交(而非只盯默认分支), 按 sha 去重、按时间倒序,
 * 这样功能分支(如 dev-xxx)上的最新提交也能出现在动态里。
 * @returns {Promise<{repoId: string, ok: boolean, added?: number, error?: string}>}
 */
export async function syncRepository(repo) {
  // 增量: 有游标就只取上次同步之后的提交; 首次同步取最近一页
  const since = repo.lastSyncedAt || undefined

  // 1) 列出所有分支; 失败则回退到「默认分支/仓库默认分支」单分支模式
  const br = await fetchBranches(repo.url)
  let branchNames
  if (br.ok && br.branches.length) {
    branchNames = br.branches.map(b => b.name)
    // 主干优先: 让 master/main(或配置的默认分支)先被扫描, 共享历史归属主干,
    // 功能分支标签只落在其独有提交上(否则老功能分支会抢走主干提交的归属, 显示混乱)
    const mainFirst = [repo.defaultBranch, 'master', 'main'].filter(Boolean)
    branchNames.sort((a, b) => rankBranch(a, mainFirst) - rankBranch(b, mainFirst))
    if (branchNames.length > MAX_BRANCHES) {
      console.warn(`[repoSync] 仓库 ${repo.id} 有 ${branchNames.length} 个分支, 只扫描前 ${MAX_BRANCHES} 个`)
      branchNames = branchNames.slice(0, MAX_BRANCHES)
    }
  } else {
    // 分支接口失败(如权限/网络): 退回默认分支(undefined = 仓库默认分支)
    branchNames = [repo.defaultBranch || undefined]
  }

  // 2) 逐分支拉取提交, 用 Map 按 sha 去重(同一提交存在于多分支时只保留一次, refName 取首次命中的分支)
  const bySha = new Map()
  let anyOk = false
  const failed = []
  for (const name of branchNames) {
    const r = await fetchCommits(repo.url, { branch: name, since, perPage: 50 })
    if (!r.ok) { failed.push(`${name || '默认'}: ${r.message}`); continue }
    anyOk = true
    for (const c of r.commits || []) {
      if (!bySha.has(c.sha)) bySha.set(c.sha, { ...c, refName: name || repo.defaultBranch || null })
    }
  }

  // 所有分支都拉取失败 → 记错误(比如仓库地址错/令牌失效)
  if (!anyOk) {
    const msg = (failed[0] || '同步失败').slice(0, 1000)
    await prisma.projectRepository.update({ where: { id: repo.id }, data: { syncError: msg } }).catch(() => {})
    return { repoId: repo.id.toString(), ok: false, error: msg }
  }

  // 3) 按时间倒序, 落库
  const commits = [...bySha.values()].sort((a, b) => b.happenedAt - a.happenedAt)
  let added = 0
  if (commits.length) {
    const rows = commits.map(c => ({
      projectId: repo.projectId,
      projectRepositoryId: repo.id,
      type: 'COMMIT',
      refName: c.refName,
      sha: c.sha,
      title: c.title,
      author: c.author,
      url: c.url,
      happenedAt: c.happenedAt,
      raw: c.raw
    }))
    // 靠 @@unique([projectRepositoryId, type, sha]) 幂等去重, 跨分支/跨轮次重叠的提交自动跳过
    const result = await prisma.repoActivity.createMany({ data: rows, skipDuplicates: true })
    added = result.count
    // v1.9.1: 提交信息带 #taskId → 自动挂到任务时间线; 关联失败不影响同步主流程
    await linkCommitsToTasks(repo.projectId, commits)
      .catch(e => console.warn(`[repoSync] 任务关联失败(仓库 ${repo.id}):`, e.message))
  }

  // 4) 更新游标: 用最新提交时间(而非 now), 避免时钟漂移漏取。部分分支失败仍算成功但记进 syncError 备查
  const newest = commits[0]
  await prisma.projectRepository.update({
    where: { id: repo.id },
    data: {
      lastSyncedAt: newest?.happenedAt || repo.lastSyncedAt || new Date(),
      lastCommitSha: newest?.sha || repo.lastCommitSha || null,
      syncError: failed.length ? `部分分支失败: ${failed.join('; ')}`.slice(0, 1000) : null
    }
  }).catch(() => {})

  return { repoId: repo.id.toString(), ok: true, added }
}

/**
 * 同步所有已配置的 GitHub / Gitee / GitLab 仓库。
 * @param {object} [opts]
 * @param {bigint} [opts.projectId]  只同步某个项目(手动触发用)
 * @returns {Promise<{repos: number, added: number, failed: number}>}
 */
export async function syncAllRepositories({ projectId } = {}) {
  const where = { deletedAt: null, provider: { in: SYNC_PROVIDERS } }
  if (projectId != null) where.projectId = projectId
  const repos = await prisma.projectRepository.findMany({ where })

  let added = 0, failed = 0
  for (const repo of repos) {
    try {
      const r = await syncRepository(repo)
      if (r.ok) added += r.added || 0
      else failed++
    } catch (e) {
      failed++
      console.error(`[repoSync] 仓库 ${repo.id} 同步异常:`, e.message)
    }
  }
  return { repos: repos.length, added, failed }
}
