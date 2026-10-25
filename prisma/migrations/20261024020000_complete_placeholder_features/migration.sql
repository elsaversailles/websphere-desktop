-- Make submitted ideas carry real classification/readiness metadata instead of UI-only placeholders.
ALTER TABLE `Idea` ADD COLUMN `category` VARCHAR(120) NOT NULL DEFAULT 'Academic Project',
    ADD COLUMN `readinessScore` INTEGER NOT NULL DEFAULT 0;

-- Persist the two profile privacy controls alongside the other notification preferences.
ALTER TABLE `NotificationPreference` ADD COLUMN `profileVisibility` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `activityStatus` BOOLEAN NOT NULL DEFAULT true;

-- Administrator-owned notices and private backup metadata.
CREATE TABLE `SystemNotice` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'system',
    `read` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `SystemNotice_read_createdAt_idx`(`read`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SystemBackup` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `bytes` INTEGER NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `SystemBackup_fileName_key`(`fileName`),
    INDEX `SystemBackup_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
