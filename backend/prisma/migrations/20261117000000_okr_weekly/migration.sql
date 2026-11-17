-- 周 OKR(公司管理级): 6 张新表, 外键只在 okr_* 之间; 不改任何既有表
-- CreateTable
CREATE TABLE `okr_cycles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `week_no` INTEGER NOT NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PLANNING',
    `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closed_at` DATETIME(3) NULL,
    `closed_by` BIGINT NULL,
    `reopened_at` DATETIME(3) NULL,
    `reopened_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `okr_cycles_year_week_no_key`(`year`, `week_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_objectives` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cycle_id` BIGINT NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 1,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `weight` DOUBLE NOT NULL DEFAULT 100,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ON_TRACK',
    `self_score` INTEGER NULL,
    `manager_score` INTEGER NULL,
    `manager_comment` VARCHAR(500) NULL,
    `submitted_at` DATETIME(3) NULL,
    `late_submit` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_objectives_cycle_id_owner_id_idx`(`cycle_id`, `owner_id`),
    INDEX `okr_objectives_owner_id_idx`(`owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_key_results` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `objective_id` BIGINT NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 1,
    `title` VARCHAR(200) NOT NULL,
    `metric_type` VARCHAR(10) NOT NULL DEFAULT 'BINARY',
    `unit` VARCHAR(20) NULL,
    `target_value` DOUBLE NULL,
    `current_value` DOUBLE NOT NULL DEFAULT 0,
    `weight` DOUBLE NOT NULL DEFAULT 100,
    `status` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `okr_key_results_objective_id_idx`(`objective_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_updates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cycle_id` BIGINT NOT NULL,
    `objective_id` BIGINT NOT NULL,
    `kr_id` BIGINT NULL,
    `date` DATE NOT NULL,
    `kind` VARCHAR(10) NOT NULL DEFAULT 'MIDWEEK',
    `content` TEXT NOT NULL,
    `value_before` DOUBLE NULL,
    `value_after` DOUBLE NULL,
    `status_before` VARCHAR(20) NULL,
    `status_after` VARCHAR(20) NULL,
    `source` VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    `source_quote` VARCHAR(1000) NULL,
    `agent_profile_id` BIGINT NULL,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `okr_updates_objective_id_created_at_idx`(`objective_id`, `created_at`),
    INDEX `okr_updates_cycle_id_idx`(`cycle_id`),
    INDEX `okr_updates_kr_id_idx`(`kr_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_scores` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cycle_id` BIGINT NOT NULL,
    `objective_id` BIGINT NOT NULL,
    `scorer_id` BIGINT NOT NULL,
    `role` VARCHAR(10) NOT NULL,
    `score` INTEGER NOT NULL,
    `comment` VARCHAR(500) NULL,
    `source` VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `okr_scores_objective_id_role_at_idx`(`objective_id`, `role`, `at`),
    INDEX `okr_scores_cycle_id_idx`(`cycle_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `okr_misses` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `objective_id` BIGINT NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `carried_to_cycle_id` BIGINT NULL,
    `carried_to_objective_id` BIGINT NULL,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `okr_misses_objective_id_idx`(`objective_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `okr_objectives` ADD CONSTRAINT `okr_objectives_cycle_id_fkey` FOREIGN KEY (`cycle_id`) REFERENCES `okr_cycles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `okr_key_results` ADD CONSTRAINT `okr_key_results_objective_id_fkey` FOREIGN KEY (`objective_id`) REFERENCES `okr_objectives`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `okr_updates` ADD CONSTRAINT `okr_updates_cycle_id_fkey` FOREIGN KEY (`cycle_id`) REFERENCES `okr_cycles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `okr_updates` ADD CONSTRAINT `okr_updates_objective_id_fkey` FOREIGN KEY (`objective_id`) REFERENCES `okr_objectives`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `okr_updates` ADD CONSTRAINT `okr_updates_kr_id_fkey` FOREIGN KEY (`kr_id`) REFERENCES `okr_key_results`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `okr_scores` ADD CONSTRAINT `okr_scores_cycle_id_fkey` FOREIGN KEY (`cycle_id`) REFERENCES `okr_cycles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `okr_scores` ADD CONSTRAINT `okr_scores_objective_id_fkey` FOREIGN KEY (`objective_id`) REFERENCES `okr_objectives`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `okr_misses` ADD CONSTRAINT `okr_misses_objective_id_fkey` FOREIGN KEY (`objective_id`) REFERENCES `okr_objectives`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

