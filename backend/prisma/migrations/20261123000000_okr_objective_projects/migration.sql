-- OKR 5.0: O 挂项目(多项目)。只建新表, 不动已有数据。
--   一个 O 可挂多个项目; 唯一键 (objective_id, project_id) 防重复, 按 project_id 建索引供按项目查询。
--   不建外键 / 级联: 项目被删时保留关联行, 查询时过滤掉不存在的项目。
CREATE TABLE `okr_objective_projects` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `objective_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `okr_objective_projects_objective_id_project_id_key`(`objective_id`, `project_id`),
    INDEX `okr_objective_projects_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
