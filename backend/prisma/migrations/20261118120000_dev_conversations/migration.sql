-- CreateTable
CREATE TABLE `dev_conversations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uid` VARCHAR(64) NOT NULL,
    `source` VARCHAR(24) NOT NULL,
    `stage` VARCHAR(16) NOT NULL DEFAULT 'GENERAL',
    `engineer_id` BIGINT NULL,
    `project_id` BIGINT NULL,
    `task_id` BIGINT NULL,
    `milestone_id` BIGINT NULL,
    `model` VARCHAR(60) NULL,
    `started_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `turns` INTEGER NOT NULL DEFAULT 0,
    `tokens` INTEGER NULL,
    `cost` DECIMAL(12, 4) NULL,
    `branch` VARCHAR(120) NULL,
    `cwd` VARCHAR(300) NULL,
    `title` VARCHAR(200) NULL,
    `summary` TEXT NULL,
    `decisions` JSON NULL,
    `pitfalls` JSON NULL,
    `tags` JSON NULL,
    `commit_shas` JSON NULL,
    `body` JSON NULL,
    `body_redacted` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING_LINK',
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `dev_conversations_uid_key`(`uid`),
    INDEX `dev_conversations_project_id_idx`(`project_id`),
    INDEX `dev_conversations_engineer_id_idx`(`engineer_id`),
    INDEX `dev_conversations_stage_idx`(`stage`),
    INDEX `dev_conversations_source_idx`(`source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dev_conversation_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT NOT NULL,
    `seq` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `text` TEXT NOT NULL,
    `files` JSON NULL,
    `occurred_at` DATETIME(3) NULL,

    UNIQUE INDEX `dev_conversation_events_conversation_id_seq_key`(`conversation_id`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dev_experiences` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'EXPERIENCE',
    `body` TEXT NOT NULL,
    `project_id` BIGINT NULL,
    `conversation_id` BIGINT NULL,
    `tags` JSON NULL,
    `reusable_level` INTEGER NOT NULL DEFAULT 2,
    `obsidian_path` VARCHAR(191) NULL,
    `synced_at` DATETIME(3) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `dev_experiences_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dev_conversation_events` ADD CONSTRAINT `dev_conversation_events_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `dev_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
