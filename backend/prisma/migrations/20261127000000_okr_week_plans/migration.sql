-- 精简第一轮: 本周项目整体计划(一周一份 Markdown, 全员可读, ADMIN / MANAGER 可写), 取代按项目拆分的 okr_project_docs。
--   只建新表, 不动已有数据; okr_project_docs 与 /api/okr/projects* 先保留(前端这轮拿掉入口)。
--   不建外键(与其他 okr_* 表一致)。
CREATE TABLE `okr_week_plans` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `week_no` INTEGER NOT NULL,
    `title` VARCHAR(200) NULL,
    `content_md` TEXT NOT NULL,
    `updated_by_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `okr_week_plans_year_week_no_key`(`year`, `week_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
