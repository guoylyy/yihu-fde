-- System settings store URLs (logo, public address), longer than the original 200 characters
ALTER TABLE `app_settings` MODIFY `value` VARCHAR(1000) NOT NULL;
