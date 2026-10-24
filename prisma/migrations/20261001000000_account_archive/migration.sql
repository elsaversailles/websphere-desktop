-- AlterTable: add the `archived` account status and record when an account was archived.
ALTER TABLE `User`
  MODIFY `status` ENUM('active', 'suspended', 'deactivated', 'removed', 'locked', 'archived') NOT NULL DEFAULT 'active',
  ADD COLUMN `archivedAt` DATETIME(3) NULL;
