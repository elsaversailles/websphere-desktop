-- Existing votes have no verified content snapshot and must be repeated before project creation.
ALTER TABLE `PollOption` ADD COLUMN `contentHash` VARCHAR(64) NULL;
