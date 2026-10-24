-- Track successful sign-ins so the inactive-account alert can identify accounts
-- that have not returned to WebSphere within the administrator's selected window.
ALTER TABLE `User` ADD COLUMN `lastLoginAt` DATETIME(3) NULL;
CREATE INDEX `User_status_lastLoginAt_idx` ON `User`(`status`, `lastLoginAt`);
