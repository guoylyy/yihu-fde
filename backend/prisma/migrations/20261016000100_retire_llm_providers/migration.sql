-- Models now come only from Yihu One: retire configs for other providers (soft delete; the keys stay in the row).
UPDATE `llm_configs` SET `deleted_at` = NOW(3), `is_default` = false
  WHERE `provider` <> 'YIHU_ONE' AND `deleted_at` IS NULL;
