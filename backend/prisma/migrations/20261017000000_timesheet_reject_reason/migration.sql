-- Keep the reason when a timesheet is rejected (shown to the engineer, cleared on resubmit)
ALTER TABLE `timesheets` ADD COLUMN `reject_reason` VARCHAR(500) NULL;
