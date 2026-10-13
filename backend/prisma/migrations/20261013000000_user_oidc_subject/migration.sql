-- AlterTable
ALTER TABLE `users` ADD COLUMN `oidc_subject` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_oidc_subject_key` ON `users`(`oidc_subject`);
