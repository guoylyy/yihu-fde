// 活动流辅助（B2）
// 在业务关键事件处调用，跨实体汇总到 /api/fde/activities
import prisma from './prisma.js'

/**
 * 记录一条活动
 * @param {Object} opts
 * @param {BigInt|number|null} opts.actorId   - 触发者 userId
 * @param {string} opts.entity                 - project / task / timesheet / customer
 * @param {BigInt|number} opts.entityId
 * @param {string} opts.action                 - created / updated / status_changed / completed / approved / assigned / commented
 * @param {string} opts.summary                - 一句话
 * @param {Object|null} opts.data              - 附加数据
 */
export async function recordActivity({ actorId, entity, entityId, action, summary, data = null }) {
  try {
    return await prisma.activity.create({
      data: {
        actorId: actorId ? (typeof actorId === 'bigint' ? actorId : BigInt(actorId)) : null,
        entity,
        entityId: typeof entityId === 'bigint' ? entityId : BigInt(entityId),
        action,
        summary,
        data: data ? JSON.stringify(data) : null
      }
    })
  } catch (e) {
    console.error('[activity] 记录失败:', e.message)
    return null
  }
}
