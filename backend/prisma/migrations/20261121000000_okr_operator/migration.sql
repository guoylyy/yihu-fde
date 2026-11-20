-- OKR 2.0 第一轮: 主管代管留痕。只加可空列/默认值列, 不改已有数据。
--   operator_id: 不是本人、由主管代为操作时记操作人 userId; 本人自己操作为 NULL
--   submitted_by_operator: 这份计划是主管代为提交的(迟交仍按被操作人的周期截止判定)
ALTER TABLE `okr_objectives`
  ADD COLUMN `operator_id` BIGINT NULL,
  ADD COLUMN `submitted_by_operator` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `okr_updates` ADD COLUMN `operator_id` BIGINT NULL;

ALTER TABLE `okr_scores` ADD COLUMN `operator_id` BIGINT NULL;
