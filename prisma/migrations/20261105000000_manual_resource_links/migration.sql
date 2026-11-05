ALTER TABLE `LinkedResource` DROP FOREIGN KEY `LinkedResource_connectionId_fkey`;
ALTER TABLE `LinkedResource` MODIFY `connectionId` VARCHAR(191) NULL,
  ADD COLUMN `provider` ENUM('google', 'microsoft', 'notion', 'trello', 'asana', 'canva') NULL;
ALTER TABLE `LinkedResource` ADD CONSTRAINT `LinkedResource_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `ToolConnection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
