-- 0.6.2: OKR 二级确认 + 变更申请 + 修改记录。
--   确认是「某人某周」的(员工确认 → 主管确认 → 锁定), 而 okr_cycles 是全公司一周一行, 所以确认四列放在
--   按 (cycle_id, owner_id) 唯一的 okr_plan_confirms 里; lockStatus 由两列推导, 不存字段。
--   这一行同时是「改这人这周计划」的行锁(savePlan / 确认 / 变更申请 / 审批都先 SELECT ... FOR UPDATE)。
--   不建外键(与其他 okr_* 表一致)。只建新表, 不动已有数据。
CREATE TABLE `okr_plan_confirms` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cycle_id` BIGINT NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `owner_confirmed_at` DATETIME(3) NULL,
    `owner_confirmed_by` BIGINT NULL,
    `manager_confirmed_at` DATETIME(3) NULL,
    `manager_confirmed_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `okr_plan_confirms_cycle_id_owner_id_key`(`cycle_id`, `owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 变更申请: 锁定后改计划只能走这里, 主管批准后用 payload 覆盖计划
CREATE TABLE `okr_plan_changes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cycle_id` BIGINT NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `requested_by` BIGINT NOT NULL,
    `reason` TEXT NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `decided_by` BIGINT NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_note` TEXT NULL,
    `applied_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_plan_changes_cycle_id_owner_id_status_idx`(`cycle_id`, `owner_id`, `status`),
    INDEX `okr_plan_changes_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 修改记录: 只增不改。一条计划层改动一行(人类可读的 before / after)
CREATE TABLE `okr_plan_audit` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cycle_id` BIGINT NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `actor_id` BIGINT NOT NULL,
    `action` VARCHAR(30) NOT NULL,
    `target_type` VARCHAR(20) NULL,
    `target_ref` VARCHAR(120) NULL,
    `field` VARCHAR(40) NULL,
    `before_text` TEXT NULL,
    `after_text` TEXT NULL,
    `reason` TEXT NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'DIRECT',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `okr_plan_audit_cycle_id_owner_id_created_at_idx`(`cycle_id`, `owner_id`, `created_at`),
    INDEX `okr_plan_audit_actor_id_idx`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
