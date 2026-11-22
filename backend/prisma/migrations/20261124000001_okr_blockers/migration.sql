-- OKR 6.0: O / KR 的外部依赖 / 卡点 / 风险。只加列, 不动已有数据(老 O 风险默认 LOW、没有卡点)。
--   blockers 非空时 blocker_owner_id(卡在谁那里, user id)与 blocker_due_date(依赖截止日)必填 —— 由服务层校验(8120)。
--   blocker_due_date 建索引: 每天的到期提醒按它扫。
ALTER TABLE `okr_objectives`
    ADD COLUMN `blockers` TEXT NULL,
    ADD COLUMN `blocker_owner_id` BIGINT NULL,
    ADD COLUMN `blocker_due_date` DATE NULL,
    ADD COLUMN `risk_level` VARCHAR(10) NOT NULL DEFAULT 'LOW';

CREATE INDEX `okr_objectives_blocker_due_date_idx` ON `okr_objectives`(`blocker_due_date`);

ALTER TABLE `okr_key_results` ADD COLUMN `blockers` TEXT NULL;
