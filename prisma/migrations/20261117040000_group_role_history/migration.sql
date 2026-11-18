CREATE TABLE `GroupRoleHistory` (
  `groupId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `role` ENUM('Project_Leader', 'Project_Member') NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`groupId`, `userId`),
  INDEX `GroupRoleHistory_userId_idx` (`userId`),
  CONSTRAINT `GroupRoleHistory_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `Group` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GroupRoleHistory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
