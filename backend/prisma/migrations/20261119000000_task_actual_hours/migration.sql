-- 0.5.0 R3: 工时降级成任务字段。只加列, 不动 timesheets 表与历史数据
ALTER TABLE `tasks` ADD COLUMN `actual_hours` DECIMAL(6, 2) NULL;
