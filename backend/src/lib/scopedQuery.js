// v2.1.14 配套工具 —— 「URL 资源定位条件 × 数据范围条件」统一求交入口
//
// 背景(串项目事故): 查询 where 写成 { id: URL资源id, deletedAt, ...scope } 时,
// 若 scope 中含 id 字段(OWN_RECORDS 范围角色返回 { id: { in: 参与资源ids } }),
// 对象 spread 会把 URL 里的资源 id 静默覆盖, findFirst 在可见集合内命中固定资源,
// 造成「所有项目返回同一份数据」的越权/串显(员工报障「每个项目会议记录都一样」即此)。
//
// 机制上阻断: 所有「资源 id × 数据范围」的查询条件一律经本函数合并, 永远走 AND 求交,
// 不给 spread 覆盖留写法空间。PR 评审两次建议(2026-09-12)后落地。
//
// 用法:
//   const scope = await buildScopeWhere(req.user, 'project')
//   const project = await prisma.project.findFirst({
//     where: buildScopedWhere({ id: projectId, deletedAt: null }, scope)
//   })

/**
 * URL 资源定位条件: 恰含一个定位键(主键 id 或外键 customerId), 可叠加软删除过滤。
 * 注意: 不可把 id 定义为必填 —— project-records 客户轴聚合等调用点走 customerId 定位。
 * @typedef {object} BaseWhereDef
 * @property {number|bigint} [id] 资源主键, 来自路由 :projectId/:id 等 URL 参数
 * @property {number|bigint} [customerId] 外键定位(如 project-records 客户轴聚合)
 * @property {null} [deletedAt] 软删除过滤, 恒为 null
 */

/**
 * 合并资源定位条件与数据范围条件为 AND 求交
 *
 * 行为约定:
 *   - scope 为 undefined/null 时, 结果等价于仅 baseWhere(单元素 AND);
 *   - scope 为空对象 {} 时, 保留为 AND 元素(Prisma 中 {} 为恒真无操作, 语义安全);
 *   - baseWhere 与 scope 存在同名键(如都有 id)时, 二者同时保留于 AND 内,
 *     由数据库取交集 —— 这是本函数存在的意义: 禁止 spread 覆盖。
 *
 * @param {BaseWhereDef & Record<string, any>} baseWhere 资源定位条件, 如 { id: projectId, deletedAt: null }
 * @param {Record<string, any>|undefined|null} scope buildScopeWhere 产出的数据范围条件; ADMIN 等全量角色为空对象, 部分角色可能为 undefined/null
 * @returns {{AND: Array<Record<string, any>>}} Prisma where 条件; scope 为假值时仅含 baseWhere
 */
export function buildScopedWhere(baseWhere, scope) {
  return { AND: [baseWhere, ...(scope ? [scope] : [])] }
}
