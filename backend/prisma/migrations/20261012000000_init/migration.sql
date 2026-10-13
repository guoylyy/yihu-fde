-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `phone` VARCHAR(20) NULL,
    `email` VARCHAR(100) NULL,
    `role` VARCHAR(32) NOT NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `avatar_url` VARCHAR(500) NULL,
    `bio` VARCHAR(500) NULL,
    `last_login_at` DATETIME(3) NULL,
    `last_active_at` DATETIME(3) NULL,
    `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    `notification_prefs` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    INDEX `users_role_idx`(`role`),
    INDEX `users_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teams` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `description` VARCHAR(500) NULL,
    `leader_id` BIGINT NULL,
    `chat_webhook_url` VARCHAR(300) NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `teams_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_memberships` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `team_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `team_memberships_user_id_idx`(`user_id`),
    UNIQUE INDEX `team_memberships_team_id_user_id_key`(`team_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_project_pins` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_project_pins_user_id_project_id_key`(`user_id`, `project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `key_hash` VARCHAR(64) NOT NULL,
    `prefix` VARCHAR(16) NOT NULL,
    `scope` VARCHAR(20) NOT NULL DEFAULT 'PERSONAL',
    `status` INTEGER NOT NULL DEFAULT 1,
    `agent_profile_id` BIGINT NULL,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `api_keys_key_hash_key`(`key_hash`),
    INDEX `api_keys_user_id_idx`(`user_id`),
    INDEX `api_keys_agent_profile_id_idx`(`agent_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_profiles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `platform` VARCHAR(30) NOT NULL DEFAULT 'OTHER',
    `capabilities` VARCHAR(500) NULL,
    `machine_name` VARCHAR(100) NULL,
    `purpose` VARCHAR(10) NULL,
    `project_ids` JSON NULL,
    `model` VARCHAR(100) NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `disabled_at` DATETIME(3) NULL,
    `disabled_by` BIGINT NULL,
    `deregistered_at` DATETIME(3) NULL,
    `last_active_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `agent_profiles_user_id_idx`(`user_id`),
    INDEX `agent_profiles_last_active_at_idx`(`last_active_at`),
    INDEX `agent_profiles_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_profile_audits` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `agent_profile_id` BIGINT NOT NULL,
    `profile_name` VARCHAR(100) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `operator_id` BIGINT NOT NULL,
    `operator_name` VARCHAR(50) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_profile_audits_agent_profile_id_created_at_idx`(`agent_profile_id`, `created_at`),
    INDEX `agent_profile_audits_operator_id_created_at_idx`(`operator_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_activity_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `agent_profile_id` BIGINT NOT NULL,
    `action` VARCHAR(100) NOT NULL,
    `entity_type` VARCHAR(50) NULL,
    `entity_id` BIGINT NULL,
    `ts` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_activity_logs_agent_profile_id_ts_idx`(`agent_profile_id`, `ts`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `llm_configs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `base_url` VARCHAR(300) NULL,
    `api_key` VARCHAR(300) NULL,
    `temperature` DECIMAL(3, 2) NULL,
    `max_tokens` INTEGER NULL,
    `system_prompt` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `remark` VARCHAR(500) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NULL,
    `link` VARCHAR(500) NULL,
    `data` TEXT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_idx`(`user_id`, `read_at`),
    INDEX `notifications_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_digest_items` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NULL,
    `link` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `digested_at` DATETIME(3) NULL,

    INDEX `notification_digest_items_user_id_digested_at_idx`(`user_id`, `digested_at`),
    INDEX `notification_digest_items_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `description` VARCHAR(200) NULL,
    `data_scope` VARCHAR(20) NOT NULL DEFAULT 'OWN_RECORDS',
    `builtin` BOOLEAN NOT NULL DEFAULT false,
    `status` INTEGER NOT NULL DEFAULT 1,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `permission` VARCHAR(100) NOT NULL,
    `roles` JSON NOT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `role_permissions_permission_key`(`permission`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NULL,
    `user_type` VARCHAR(20) NOT NULL,
    `action` VARCHAR(100) NOT NULL,
    `resource_type` VARCHAR(50) NULL,
    `resource_id` BIGINT NULL,
    `details` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_user_id_user_type_idx`(`user_id`, `user_type`),
    INDEX `audit_logs_resource_type_resource_id_idx`(`resource_type`, `resource_id`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `short_name` VARCHAR(50) NULL,
    `industry` VARCHAR(50) NULL,
    `scale` VARCHAR(20) NULL,
    `address` VARCHAR(500) NULL,
    `tags` JSON NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `source_channel` VARCHAR(20) NULL,

    INDEX `customers_name_idx`(`name`),
    INDEX `customers_industry_idx`(`industry`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contacts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `customer_id` BIGINT NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `title` VARCHAR(50) NULL,
    `phone` VARCHAR(20) NULL,
    `email` VARCHAR(100) NULL,
    `is_primary` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `contacts_customer_id_idx`(`customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `engineers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `level` VARCHAR(20) NULL,
    `skills` JSON NULL,
    `city` VARCHAR(50) NULL,
    `daily_rate` DECIMAL(10, 2) NULL,
    `bio` TEXT NULL,
    `available` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `engineers_user_id_key`(`user_id`),
    INDEX `engineers_level_idx`(`level`),
    INDEX `engineers_city_idx`(`city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `engineer_certifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `engineer_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `issuer` VARCHAR(100) NULL,
    `issued_at` DATE NULL,
    `expires_at` DATE NULL,
    `cert_no` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `engineer_certifications_engineer_id_idx`(`engineer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skills` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `category` VARCHAR(30) NULL,
    `description` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `skills_name_key`(`name`),
    INDEX `skills_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `engineer_skills` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `engineer_id` BIGINT NOT NULL,
    `skill_id` BIGINT NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 3,
    `years_exp` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `engineer_skills_engineer_id_idx`(`engineer_id`),
    INDEX `engineer_skills_skill_id_idx`(`skill_id`),
    UNIQUE INDEX `engineer_skills_engineer_id_skill_id_key`(`engineer_id`, `skill_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `customer_id` BIGINT NOT NULL,
    `type` VARCHAR(20) NULL,
    `status` ENUM('DRAFT', 'PROPOSAL', 'APPROVED', 'IN_PROGRESS', 'ACCEPTED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'PROPOSAL',
    `manager_id` BIGINT NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `budget` DECIMAL(12, 2) NULL,
    `actual_cost` DECIMAL(12, 2) NULL DEFAULT 0,
    `health` VARCHAR(10) NULL DEFAULT 'GREEN',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `acceptance_config` JSON NULL,
    `cover_image` VARCHAR(500) NULL,
    `activity_score` INTEGER NOT NULL DEFAULT 0,
    `activity_meta` JSON NULL,
    `closed_at` DATETIME(3) NULL,
    `closed_by` BIGINT NULL,
    `close_reason` VARCHAR(500) NULL,
    `status_before_close` VARCHAR(20) NULL,
    `description` TEXT NULL,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `projects_code_key`(`code`),
    INDEX `projects_customer_id_idx`(`customer_id`),
    INDEX `projects_status_idx`(`status`),
    INDEX `projects_manager_id_idx`(`manager_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_repositories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `provider` VARCHAR(20) NOT NULL DEFAULT 'GITEE',
    `description` TEXT NULL,
    `default_branch` VARCHAR(100) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `last_commit_sha` VARCHAR(64) NULL,
    `sync_error` TEXT NULL,

    INDEX `project_repositories_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `repo_activities` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `project_repository_id` BIGINT NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'COMMIT',
    `ref_name` VARCHAR(200) NULL,
    `sha` VARCHAR(64) NULL,
    `title` VARCHAR(500) NOT NULL,
    `author` VARCHAR(200) NULL,
    `status` VARCHAR(40) NULL,
    `url` VARCHAR(500) NULL,
    `happened_at` DATETIME(3) NOT NULL,
    `raw` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `repo_activities_project_id_happened_at_idx`(`project_id`, `happened_at`),
    UNIQUE INDEX `repo_activities_project_repository_id_type_sha_key`(`project_repository_id`, `type`, `sha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_members` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `engineer_id` BIGINT NULL,
    `user_id` BIGINT NULL,
    `role_in_project` VARCHAR(20) NOT NULL DEFAULT 'MEMBER',
    `join_date` DATE NULL,
    `leave_date` DATE NULL,
    `pinned_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    INDEX `project_members_project_id_idx`(`project_id`),
    INDEX `project_members_user_id_idx`(`user_id`),
    INDEX `project_members_engineer_id_idx`(`engineer_id`),
    UNIQUE INDEX `project_members_project_id_user_id_key`(`project_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `milestones` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `owner_id` BIGINT NULL,
    `planned_date` DATE NULL,
    `actual_date` DATE NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `goal` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `milestones_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_attachments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `comment_id` BIGINT NULL,
    `filename` VARCHAR(200) NOT NULL,
    `file_url` VARCHAR(500) NOT NULL,
    `file_size` BIGINT NULL,
    `uploaded_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `task_attachments_task_id_idx`(`task_id`),
    INDEX `task_attachments_comment_id_idx`(`comment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `milestone_id` BIGINT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `assignee_id` BIGINT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'TODO',
    `priority` VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    `due_date` DATE NULL,
    `planned_start_at` DATE NULL,
    `planned_end_at` DATE NULL,
    `queued_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `archived_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `source` VARCHAR(20) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `acceptance_criteria` JSON NULL,
    `review_level` VARCHAR(20) NULL DEFAULT 'L1_API',
    `acceptance_runs` INTEGER NOT NULL DEFAULT 0,
    `revision` INTEGER NOT NULL DEFAULT 0,

    INDEX `tasks_project_id_idx`(`project_id`),
    INDEX `tasks_assignee_id_idx`(`assignee_id`),
    INDEX `tasks_status_idx`(`status`),
    INDEX `tasks_source_idx`(`source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dev_dispatches` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `milestone_id` BIGINT NULL,
    `title` VARCHAR(200) NOT NULL,
    `note` TEXT NULL,
    `agent_profile_id` BIGINT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    `created_by` BIGINT NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dev_dispatches_project_id_status_idx`(`project_id`, `status`),
    INDEX `dev_dispatches_milestone_id_idx`(`milestone_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dev_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `dispatch_id` BIGINT NOT NULL,
    `task_id` BIGINT NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 0,
    `agent_profile_id` BIGINT NULL,
    `agent_name` VARCHAR(100) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `phase` VARCHAR(40) NULL,
    `message` VARCHAR(500) NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `claimed_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `heartbeat_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dev_runs_dispatch_id_seq_idx`(`dispatch_id`, `seq`),
    INDEX `dev_runs_task_id_idx`(`task_id`),
    INDEX `dev_runs_status_idx`(`status`),
    INDEX `dev_runs_agent_profile_id_idx`(`agent_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dev_run_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `run_id` BIGINT NOT NULL,
    `level` VARCHAR(10) NOT NULL DEFAULT 'INFO',
    `phase` VARCHAR(40) NULL,
    `progress` INTEGER NULL,
    `message` VARCHAR(1000) NOT NULL,
    `data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dev_run_events_run_id_id_idx`(`run_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_dependencies` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `predecessor_id` BIGINT NOT NULL,
    `successor_id` BIGINT NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'BLOCKS',
    `note` VARCHAR(200) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `task_dependencies_predecessor_id_idx`(`predecessor_id`),
    INDEX `task_dependencies_successor_id_idx`(`successor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timesheets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `engineer_id` BIGINT NOT NULL,
    `work_date` DATE NOT NULL,
    `milestone_id` BIGINT NULL,
    `task_id` BIGINT NULL,
    `work_category` VARCHAR(20) NULL,
    `hours` DECIMAL(4, 2) NOT NULL,
    `work_content` TEXT NOT NULL,
    `location` VARCHAR(100) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `approved_by` BIGINT NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `timesheets_project_id_work_date_idx`(`project_id`, `work_date`),
    INDEX `timesheets_engineer_id_work_date_idx`(`engineer_id`, `work_date`),
    INDEX `timesheets_milestone_id_idx`(`milestone_id`),
    INDEX `timesheets_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `issues` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `severity` VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `reporter_id` BIGINT NOT NULL,
    `assignee_id` BIGINT NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `issues_project_id_idx`(`project_id`),
    INDEX `issues_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `probability` VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    `impact` VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    `status` VARCHAR(20) NOT NULL DEFAULT 'IDENTIFIED',
    `mitigation` TEXT NULL,
    `owner_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `risks_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'MEETING',
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `attendees` VARCHAR(500) NULL,
    `created_by` BIGINT NOT NULL,
    `created_by_agent_id` BIGINT NULL,
    `transcript_json` TEXT NULL,
    `speaker_names` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `project_records_project_id_occurred_at_idx`(`project_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_requirements` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `record_id` BIGINT NULL,
    `title` VARCHAR(200) NOT NULL,
    `detail` TEXT NULL,
    `priority` VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
    `status` VARCHAR(15) NOT NULL DEFAULT 'DRAFT',
    `source` VARCHAR(15) NULL,
    `source_text` TEXT NULL,
    `confirmed_by` BIGINT NULL,
    `confirmed_at` DATETIME(3) NULL,
    `owner_id` BIGINT NULL,
    `owner_name` VARCHAR(50) NULL,
    `task_id` BIGINT NULL,
    `milestone_id` BIGINT NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `project_requirements_project_id_status_idx`(`project_id`, `status`),
    INDEX `project_requirements_record_id_idx`(`record_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_record_attachments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `record_id` BIGINT NOT NULL,
    `filename` VARCHAR(200) NOT NULL,
    `file_url` VARCHAR(500) NOT NULL,
    `file_size` BIGINT NULL,
    `kind` VARCHAR(10) NOT NULL DEFAULT 'FILE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_record_attachments_record_id_idx`(`record_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_reviews` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `summary` TEXT NULL,
    `achievements` TEXT NULL,
    `issues` TEXT NULL,
    `lessons` TEXT NULL,
    `satisfaction` INTEGER NULL,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `project_reviews_project_id_key`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_articles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `category` VARCHAR(50) NULL,
    `content` LONGTEXT NOT NULL,
    `tags` JSON NULL,
    `project_id` BIGINT NULL,
    `view_count` INTEGER NOT NULL DEFAULT 0,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `knowledge_articles_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `knowledge_checklist_progress` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `article_id` BIGINT NOT NULL,
    `item_key` VARCHAR(64) NOT NULL,
    `checked` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_checklist_progress_user_id_article_id_idx`(`user_id`, `article_id`),
    UNIQUE INDEX `knowledge_checklist_progress_user_id_article_id_item_key_key`(`user_id`, `article_id`, `item_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_packages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(80) NOT NULL,
    `display_name` VARCHAR(100) NULL,
    `description` VARCHAR(500) NULL,
    `category` VARCHAR(50) NULL,
    `keywords` JSON NULL,
    `content` LONGTEXT NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(10) NOT NULL DEFAULT 'DISABLED',
    `attachments` JSON NULL,
    `project_id` BIGINT NULL,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `skill_packages_name_key`(`name`),
    INDEX `skill_packages_category_idx`(`category`),
    INDEX `skill_packages_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_usage_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `skill_package_id` BIGINT NOT NULL,
    `skill_name` VARCHAR(80) NOT NULL,
    `actorType` VARCHAR(10) NOT NULL DEFAULT 'USER',
    `actor_id` BIGINT NULL,
    `actor_name` VARCHAR(100) NULL,
    `action` VARCHAR(20) NOT NULL DEFAULT 'LOAD',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `skill_usage_logs_skill_package_id_idx`(`skill_package_id`),
    INDEX `skill_usage_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_presences` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `agent_profile_id` BIGINT NOT NULL,
    `agentName` VARCHAR(100) NOT NULL,
    `project_id` BIGINT NULL,
    `project_name` VARCHAR(200) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PATROLLING',
    `activity` VARCHAR(300) NULL,
    `task_id` BIGINT NULL,
    `task_title` VARCHAR(200) NULL,
    `phase` VARCHAR(30) NULL,
    `progress` INTEGER NULL,
    `last_beat_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agent_presences_agent_profile_id_key`(`agent_profile_id`),
    INDEX `agent_presences_last_beat_at_idx`(`last_beat_at`),
    INDEX `agent_presences_project_id_idx`(`project_id`),
    INDEX `agent_presences_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activities` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor_id` BIGINT NULL,
    `entity` VARCHAR(30) NOT NULL,
    `entity_id` BIGINT NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `summary` VARCHAR(500) NOT NULL,
    `data` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activities_entity_entity_id_created_at_idx`(`entity`, `entity_id`, `created_at`),
    INDEX `activities_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `entity` VARCHAR(30) NOT NULL,
    `entity_id` BIGINT NOT NULL,
    `author_id` BIGINT NOT NULL,
    `content` TEXT NOT NULL,
    `mentions` TEXT NULL,
    `parent_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `comments_entity_entity_id_created_at_idx`(`entity`, `entity_id`, `created_at`),
    INDEX `comments_author_id_idx`(`author_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subtasks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `done` INTEGER NOT NULL DEFAULT 0,
    `order` INTEGER NOT NULL DEFAULT 0,
    `completed_at` DATETIME(3) NULL,
    `completed_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `subtasks_task_id_order_idx`(`task_id`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_conversations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `title` TEXT NULL,
    `openhex_id` VARCHAR(64) NULL,
    `source` VARCHAR(20) NOT NULL DEFAULT 'INTERNAL',
    `project_id` BIGINT NULL,
    `customer_id` BIGINT NULL,
    `agent_profile_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `agent_conversations_user_id_idx`(`user_id`),
    INDEX `agent_conversations_project_id_idx`(`project_id`),
    INDEX `agent_conversations_agent_profile_id_idx`(`agent_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_messages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `text` TEXT NOT NULL,
    `ts` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_messages_conversation_id_idx`(`conversation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_settings` (
    `key` VARCHAR(50) NOT NULL,
    `value` VARCHAR(200) NOT NULL,
    `updated_by` BIGINT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acceptance_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `rev` INTEGER NOT NULL,
    `revision` INTEGER NOT NULL,
    `conclusion` VARCHAR(20) NOT NULL,
    `shadow` BOOLEAN NOT NULL DEFAULT false,
    `results` JSON NOT NULL,
    `duration_ms` INTEGER NULL,
    `executed_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `acceptance_records_task_id_idx`(`task_id`),
    INDEX `acceptance_records_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(80) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `summary` VARCHAR(300) NOT NULL,
    `layer` VARCHAR(20) NOT NULL,
    `maturity` VARCHAR(4) NOT NULL DEFAULT 'L0',
    `status` VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    `authorization` VARCHAR(20) NOT NULL DEFAULT 'RESTRICTED',
    `tech_stack` JSON NULL,
    `industries` JSON NULL,
    `tags` JSON NULL,
    `keywords` JSON NULL,
    `source_project_id` BIGINT NULL,
    `source_repo` VARCHAR(300) NULL,
    `source_paths` JSON NULL,
    `asset_repo_path` VARCHAR(200) NULL,
    `readme` LONGTEXT NULL,
    `ontology` JSON NULL,
    `demo_url` VARCHAR(500) NULL,
    `screenshots` JSON NULL,
    `owner_id` BIGINT NULL,
    `est_saved_days` DECIMAL(5, 1) NULL,
    `current_version` VARCHAR(40) NULL,
    `usage_count` INTEGER NOT NULL DEFAULT 0,
    `ai_generated` BOOLEAN NOT NULL DEFAULT false,
    `created_by` BIGINT NULL,
    `updated_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `assets_slug_key`(`slug`),
    INDEX `assets_layer_status_idx`(`layer`, `status`),
    INDEX `assets_maturity_idx`(`maturity`),
    INDEX `assets_source_project_id_idx`(`source_project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_versions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `asset_id` BIGINT NOT NULL,
    `version` VARCHAR(40) NOT NULL,
    `changelog` TEXT NULL,
    `commit_sha` VARCHAR(64) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `asset_versions_asset_id_version_key`(`asset_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_usages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `asset_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `task_id` BIGINT NULL,
    `mode` VARCHAR(20) NOT NULL DEFAULT 'REFERENCE',
    `saved_days` DECIMAL(5, 1) NULL,
    `feedback` TEXT NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `asset_usages_asset_id_idx`(`asset_id`),
    INDEX `asset_usages_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_links` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `asset_id` BIGINT NOT NULL,
    `target_type` VARCHAR(20) NOT NULL,
    `target_id` BIGINT NOT NULL,
    `note` VARCHAR(200) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `asset_links_target_type_target_id_idx`(`target_type`, `target_id`),
    UNIQUE INDEX `asset_links_asset_id_target_type_target_id_key`(`asset_id`, `target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_topics` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `description` VARCHAR(500) NULL,
    `icon` VARCHAR(20) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_by` BIGINT NOT NULL,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ideas` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `topic_id` BIGINT NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NOT NULL,
    `author_id` BIGINT NOT NULL,
    `agent_profile_id` BIGINT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `pinned` INTEGER NOT NULL DEFAULT 0,
    `attachments` JSON NULL,
    `like_count` INTEGER NOT NULL DEFAULT 0,
    `comment_count` INTEGER NOT NULL DEFAULT 0,
    `last_activity_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ai_summary` TEXT NULL,
    `ai_summary_at` DATETIME(3) NULL,
    `project_id` BIGINT NULL,
    `milestone_id` BIGINT NULL,
    `adopted_by` BIGINT NULL,
    `adopted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `ideas_topic_id_last_activity_at_idx`(`topic_id`, `last_activity_at`),
    INDEX `ideas_status_idx`(`status`),
    INDEX `ideas_author_id_idx`(`author_id`),
    INDEX `ideas_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idea_likes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `idea_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `idea_likes_idea_id_user_id_key`(`idea_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_leader_id_fkey` FOREIGN KEY (`leader_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_memberships` ADD CONSTRAINT `team_memberships_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_memberships` ADD CONSTRAINT `team_memberships_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_project_pins` ADD CONSTRAINT `user_project_pins_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_project_pins` ADD CONSTRAINT `user_project_pins_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_agent_profile_id_fkey` FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_profiles` ADD CONSTRAINT `agent_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_activity_logs` ADD CONSTRAINT `agent_activity_logs_agent_profile_id_fkey` FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `engineers` ADD CONSTRAINT `engineers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `engineer_certifications` ADD CONSTRAINT `engineer_certifications_engineer_id_fkey` FOREIGN KEY (`engineer_id`) REFERENCES `engineers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `engineer_skills` ADD CONSTRAINT `engineer_skills_engineer_id_fkey` FOREIGN KEY (`engineer_id`) REFERENCES `engineers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `engineer_skills` ADD CONSTRAINT `engineer_skills_skill_id_fkey` FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_manager_id_fkey` FOREIGN KEY (`manager_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_repositories` ADD CONSTRAINT `project_repositories_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repo_activities` ADD CONSTRAINT `repo_activities_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repo_activities` ADD CONSTRAINT `repo_activities_project_repository_id_fkey` FOREIGN KEY (`project_repository_id`) REFERENCES `project_repositories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_engineer_id_fkey` FOREIGN KEY (`engineer_id`) REFERENCES `engineers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `milestones` ADD CONSTRAINT `milestones_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `milestones` ADD CONSTRAINT `milestones_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_attachments` ADD CONSTRAINT `task_attachments_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_milestone_id_fkey` FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dev_runs` ADD CONSTRAINT `dev_runs_dispatch_id_fkey` FOREIGN KEY (`dispatch_id`) REFERENCES `dev_dispatches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dev_runs` ADD CONSTRAINT `dev_runs_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dev_run_events` ADD CONSTRAINT `dev_run_events_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `dev_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependencies_predecessor_id_fkey` FOREIGN KEY (`predecessor_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependencies_successor_id_fkey` FOREIGN KEY (`successor_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_engineer_id_fkey` FOREIGN KEY (`engineer_id`) REFERENCES `engineers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_milestone_id_fkey` FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `issues` ADD CONSTRAINT `issues_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risks` ADD CONSTRAINT `risks_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_records` ADD CONSTRAINT `project_records_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_requirements` ADD CONSTRAINT `project_requirements_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_requirements` ADD CONSTRAINT `project_requirements_record_id_fkey` FOREIGN KEY (`record_id`) REFERENCES `project_records`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_record_attachments` ADD CONSTRAINT `project_record_attachments_record_id_fkey` FOREIGN KEY (`record_id`) REFERENCES `project_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_reviews` ADD CONSTRAINT `project_reviews_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_articles` ADD CONSTRAINT `knowledge_articles_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_articles` ADD CONSTRAINT `knowledge_articles_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `knowledge_checklist_progress` ADD CONSTRAINT `knowledge_checklist_progress_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `knowledge_articles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skill_packages` ADD CONSTRAINT `skill_packages_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skill_usage_logs` ADD CONSTRAINT `skill_usage_logs_skill_package_id_fkey` FOREIGN KEY (`skill_package_id`) REFERENCES `skill_packages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_presences` ADD CONSTRAINT `agent_presences_agent_profile_id_fkey` FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_messages` ADD CONSTRAINT `agent_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_source_project_id_fkey` FOREIGN KEY (`source_project_id`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_versions` ADD CONSTRAINT `asset_versions_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_usages` ADD CONSTRAINT `asset_usages_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_usages` ADD CONSTRAINT `asset_usages_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_links` ADD CONSTRAINT `asset_links_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ideas` ADD CONSTRAINT `ideas_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `idea_topics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `idea_likes` ADD CONSTRAINT `idea_likes_idea_id_fkey` FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

