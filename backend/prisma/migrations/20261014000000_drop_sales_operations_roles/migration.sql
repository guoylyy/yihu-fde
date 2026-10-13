-- Only three built-in roles remain: ADMIN, MANAGER, FDE_ENGINEER.
-- Operations (PLATFORM) users become project managers; sales (SALES) users become engineers.
UPDATE `users` SET `role` = 'MANAGER' WHERE `role` = 'PLATFORM';
UPDATE `users` SET `role` = 'FDE_ENGINEER' WHERE `role` = 'SALES';

-- Engineer profiles for sales users already exist (SALES was a dispatchable role), nothing to create.

DELETE FROM `roles` WHERE `code` IN ('PLATFORM', 'SALES');

-- Drop the two codes from permission overrides.
UPDATE `role_permissions`
  SET `roles` = JSON_REMOVE(`roles`, JSON_UNQUOTE(JSON_SEARCH(`roles`, 'one', 'PLATFORM')))
  WHERE JSON_SEARCH(`roles`, 'one', 'PLATFORM') IS NOT NULL;
UPDATE `role_permissions`
  SET `roles` = JSON_REMOVE(`roles`, JSON_UNQUOTE(JSON_SEARCH(`roles`, 'one', 'SALES')))
  WHERE JSON_SEARCH(`roles`, 'one', 'SALES') IS NOT NULL;
