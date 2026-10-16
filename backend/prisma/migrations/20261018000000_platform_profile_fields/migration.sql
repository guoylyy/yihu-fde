-- 资料里哪些字段来自以虎 One(个人中心里只读)
ALTER TABLE `users` ADD COLUMN `platform_fields` JSON NULL;
