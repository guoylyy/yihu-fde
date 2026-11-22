-- OKR 7.0: 个人 OKR 模板(常用的周计划 Markdown), 配合 /api/okr/plan/bulk-import 使用。只建新表, 不动已有数据。
--   只归本人(user_id), 不建外键(与其他 okr_* 表一致); content_md 用 MEDIUMTEXT: 上限 20000 字的中文超过 TEXT 的 64KB。
CREATE TABLE `okr_templates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `content_md` MEDIUMTEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `okr_templates_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
