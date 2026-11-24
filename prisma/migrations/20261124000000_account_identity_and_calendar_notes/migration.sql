ALTER TABLE `User`
  ADD COLUMN `middleName` VARCHAR(191) NULL,
  ADD COLUMN `googleSubject` VARCHAR(191) NULL,
  ADD COLUMN `passwordEnabled` BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX `User_googleSubject_key` ON `User`(`googleSubject`);

CREATE TABLE `CalendarNote` (
  `ownerId` VARCHAR(191) NOT NULL,
  `date` VARCHAR(10) NOT NULL,
  `body` TEXT NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`ownerId`, `date`),
  CONSTRAINT `CalendarNote_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AdminActivitySample` (
  `metric` VARCHAR(16) NOT NULL,
  `date` VARCHAR(10) NOT NULL,
  `count` INTEGER NOT NULL,
  PRIMARY KEY (`metric`, `date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LinkedResource`
  ADD COLUMN `storageKey` VARCHAR(191) NULL,
  ADD COLUMN `fileSize` INTEGER NULL,
  ADD COLUMN `academicUseConfirmed` BOOLEAN NULL;
