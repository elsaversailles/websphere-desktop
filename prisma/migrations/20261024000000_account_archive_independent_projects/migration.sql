-- Projects can be created before a group chat exists. Keep the relationship when one is chosen.
ALTER TABLE `Project` DROP FOREIGN KEY `Project_groupId_fkey`;
ALTER TABLE `Project` MODIFY `groupId` VARCHAR(191) NULL;
ALTER TABLE `Project` ADD CONSTRAINT `Project_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
