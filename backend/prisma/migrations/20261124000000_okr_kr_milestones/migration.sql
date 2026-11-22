-- OKR 6.0: 阶段型 KR(metric_type = 'MILESTONE')。只加一列, 不动已有数据。
--   target_value = 阶段总数, current_value = 已完成阶段数(复用现有列);
--   milestones = 阶段明细 JSON 数组 [{name, dueDate, done}], done 由服务器按已完成阶段数回写。其他类型为空。
ALTER TABLE `okr_key_results` ADD COLUMN `milestones` TEXT NULL;
