-- CreateTable
CREATE TABLE `ProjectToolMonitor` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `connectionId` VARCHAR(191) NOT NULL,
    `provider` ENUM('google', 'microsoft', 'trello', 'asana', 'canva', 'figma') NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `externalUrl` TEXT NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSyncedAt` DATETIME(3) NULL,
    `syncState` VARCHAR(191) NULL,

    UNIQUE INDEX `ProjectToolMonitor_projectId_provider_externalId_key`(`projectId`, `provider`, `externalId`),
    INDEX `ProjectToolMonitor_connectionId_idx`(`connectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProjectToolMonitor` ADD CONSTRAINT `ProjectToolMonitor_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectToolMonitor` ADD CONSTRAINT `ProjectToolMonitor_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `ToolConnection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
