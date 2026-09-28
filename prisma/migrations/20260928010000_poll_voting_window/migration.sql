-- AlterTable
ALTER TABLE `IdeaPoll` ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `closedBy` VARCHAR(191) NULL,
    ADD COLUMN `closesAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `IdeaPoll_groupId_createdAt_idx` ON `IdeaPoll`(`groupId`, `createdAt`);

-- CreateIndex
CREATE INDEX `IdeaPoll_open_closesAt_idx` ON `IdeaPoll`(`open`, `closesAt`);
