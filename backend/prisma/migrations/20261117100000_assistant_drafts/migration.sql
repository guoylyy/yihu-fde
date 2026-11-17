-- AI 助手草稿: 1 张新表, 不改任何既有表(会话/消息复用 agent_conversations / agent_messages)
-- CreateTable
CREATE TABLE `assistant_drafts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `conversation_id` BIGINT NULL,
    `message_id` BIGINT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `payload` JSON NOT NULL,
    `labels` JSON NULL,
    `missing` JSON NULL,
    `status` VARCHAR(15) NOT NULL DEFAULT 'PENDING',
    `result_id` VARCHAR(32) NULL,
    `last_error` VARCHAR(500) NULL,
    `locked_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `discarded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assistant_drafts_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `assistant_drafts_conversation_id_idx`(`conversation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
