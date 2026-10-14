-- FDE runs only as a Yihu One app: no local passwords, roles partly synced from the platform,
-- teams mirrored from platform departments. Additive only (Yihu One rolls back code, not the database).
ALTER TABLE `users` MODIFY `password_hash` VARCHAR(255) NULL;
ALTER TABLE `users` ADD COLUMN `role_source` VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN `platform_disabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `mcp_last_used_at` DATETIME(3) NULL,
  ADD COLUMN `kit_downloaded_at` DATETIME(3) NULL;
ALTER TABLE `teams` ADD COLUMN `platform_dept_id` INTEGER NULL;
CREATE UNIQUE INDEX `teams_platform_dept_id_key` ON `teams`(`platform_dept_id`);
