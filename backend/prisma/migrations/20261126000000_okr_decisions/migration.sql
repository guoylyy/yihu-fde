-- OKR 9.0: 决策记录(老板 / 主管主持决策时定下的事), 可挂 O / 项目 / 周期, 按时间线回看。只建新表, 不动已有数据。
--   不建外键(与其他 okr_* 表一致): O 被删时决策保留, objective_id 置空并在 detail 前加「[原 O 已删除]」(服务层做, 不级联)。
--   软删: deleted_at 非空即视为已删, 所有读接口过滤掉。
CREATE TABLE `okr_decisions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cycle_id` BIGINT NULL,
    `objective_id` BIGINT NULL,
    `project_id` BIGINT NULL,
    `title` VARCHAR(200) NOT NULL,
    `detail` TEXT NOT NULL,
    `rationale` TEXT NULL,
    `impact` TEXT NULL,
    `decided_by_id` BIGINT NOT NULL,
    `decided_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `superseded_by` BIGINT NULL,
    `created_by_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by_id` BIGINT NULL,

    INDEX `okr_decisions_cycle_id_idx`(`cycle_id`),
    INDEX `okr_decisions_objective_id_idx`(`objective_id`),
    INDEX `okr_decisions_project_id_idx`(`project_id`),
    INDEX `okr_decisions_decided_at_idx`(`decided_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
