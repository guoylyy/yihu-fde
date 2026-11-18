-- 0.5.0 R4a: 内置角色「组长」(TEAM_LEAD, dataScope=TEAM), 排在 MANAGER 与 FDE_ENGINEER 之间。
-- 只加数据不改表; 可重复执行(全部按 code 唯一键 upsert, 排序只在首次插入组长时挪一次)。
--
-- 先把三个老内置角色补齐(已有则不动): 生产镜像只跑 migrate deploy 不跑 seed, roles 表可能是空的;
-- 而 loadRoles() 读到非空表就以表为准 —— 只插一行组长会让 ADMIN 等从角色缓存里消失。
INSERT INTO `roles` (`code`, `name`, `description`, `data_scope`, `builtin`, `status`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('ADMIN',        '系统管理员', NULL, 'ALL',          true, 1, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('MANAGER',      '项目经理',   NULL, 'OWN_PROJECTS', true, 1, 2, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('FDE_ENGINEER', 'FDE 工程师', NULL, 'OWN_RECORDS',  true, 1, 3, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `code` = `code`;

-- 组长还不存在时, 把 MANAGER 之后的角色整体后移一位, 给组长腾出 MANAGER+1 的位置
SET @mgr_sort := (SELECT `sort_order` FROM `roles` WHERE `code` = 'MANAGER');
SET @has_lead := (SELECT COUNT(*) FROM `roles` WHERE `code` = 'TEAM_LEAD');
UPDATE `roles` SET `sort_order` = `sort_order` + 1 WHERE @has_lead = 0 AND `sort_order` > @mgr_sort;

INSERT INTO `roles` (`code`, `name`, `description`, `data_scope`, `builtin`, `status`, `sort_order`, `created_at`, `updated_at`)
VALUES ('TEAM_LEAD', '组长', '带一个团队的工程师: 团队视图看本组(能看不能评)', 'TEAM', true, 1, @mgr_sort + 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `data_scope` = 'TEAM', `builtin` = true;
