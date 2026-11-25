CREATE TABLE `ProjectActivityDay` (
    `projectId` VARCHAR(191) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    PRIMARY KEY (`projectId`, `date`),
    CONSTRAINT `ProjectActivityDay_projectId_fkey`
        FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
