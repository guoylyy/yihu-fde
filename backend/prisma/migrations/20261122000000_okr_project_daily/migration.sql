-- OKR 4.0: 项目周 OKR 文档 + 每日进展总结。只建新表, 不动已有数据。
--   okr_project_docs: 一周一项目一份 Markdown 文档, 重复保存覆盖(保留 updated_by / updated_at)
--   okr_daily_summaries: 每人每天一篇人写的总结; 自动聚合部分从 okr_updates 现算
CREATE TABLE `okr_project_docs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `year` INTEGER NOT NULL,
    `week_no` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content_md` MEDIUMTEXT NOT NULL,
    `source_file` VARCHAR(255) NULL,
    `created_by` BIGINT NOT NULL,
    `updated_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `okr_project_docs_project_id_year_week_no_key`(`project_id`, `year`, `week_no`),
    INDEX `okr_project_docs_year_week_no_idx`(`year`, `week_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `okr_daily_summaries` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `date` DATE NOT NULL,
    `summary_md` TEXT NULL,
    `created_by` BIGINT NOT NULL,
    `operator_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `okr_daily_summaries_user_id_date_key`(`user_id`, `date`),
    INDEX `okr_daily_summaries_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
