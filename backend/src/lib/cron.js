// 后台定时任务
import { releaseStaleRuns } from '../services/devDispatch.js'   // v2.9.0(#1162)
import { syncAllRepositories } from '../services/repoSync.js'
import { computeAllActivityScores } from '../services/projectActivity.js'
import { runDailyDigest } from './notificationDigest.js'

let started = false

export function startCronJobs() {
  if (started) return
  started = true
  console.log('[cron] 启动定时任务')

  // v2.9.0(#1162) 派工: 机器人失联释放 —— 每 10 分钟扫一次, 心跳超 2 小时的运行退回队列供其他机器人接手
  setTimeout(() => runWithCatch('devRunRelease', () => releaseStaleRuns()), 45 * 1000)
  setInterval(() => runWithCatch('devRunRelease', () => releaseStaleRuns()), 10 * 60 * 1000)

  // v2.5.5(#912) 通知每日摘要: 噪音档通知先入队, 每小时检查一次, 8 点后把「昨天及更早」的合并成每人一条(幂等: 已合并的带 digested_at)
  setTimeout(() => runWithCatch('notificationDigest', () => runDailyDigest()), 75 * 1000)
  setInterval(() => runWithCatch('notificationDigest', () => runDailyDigest()), 60 * 60 * 1000)

  // v1.4.x 项目活跃度评分: 启动 45s 后算一次, 之后每小时重算(基于已同步提交数据)
  setTimeout(() => runWithCatch('activityScore', () => computeAllActivityScores()), 45 * 1000)
  setInterval(() => runWithCatch('activityScore', () => computeAllActivityScores()), 60 * 60 * 1000)

  // 仓库提交同步: 启动 30s 后跑一次, 之后每 20 分钟增量拉取已配置仓库的提交
  // (同步完顺手重算活跃度, 提交动态与评分同频)。配了任一平台令牌即开启; 只同步公开仓库可设 REPO_SYNC_ENABLED=true
  const { GITHUB_TOKEN, GITEE_ACCESS_TOKEN, GITLAB_TOKEN, REPO_SYNC_ENABLED } = process.env
  if (GITHUB_TOKEN || GITEE_ACCESS_TOKEN || GITLAB_TOKEN || REPO_SYNC_ENABLED === 'true') {
    const syncThenScore = () => syncAllRepositories().then(r => computeAllActivityScores().then(() => r))
    setTimeout(() => runWithCatch('repoSync', syncThenScore), 30 * 1000)
    const repoSyncInterval = 20 * 60 * 1000
    setInterval(() => runWithCatch('repoSync', syncThenScore), repoSyncInterval)
  } else {
    console.log('[cron] 未配置代码平台令牌(GITHUB_TOKEN / GITEE_ACCESS_TOKEN / GITLAB_TOKEN), 跳过仓库提交同步')
  }
}

async function runWithCatch(name, fn) {
  try {
    const result = await fn()
    console.log(`[cron.${name}] OK`, result != null && typeof result === 'object' ? JSON.stringify(result) : '')
  } catch (e) {
    console.error(`[cron.${name}] 失败:`, e.message)
  }
}
