-- Planned task dates are separate from startedAt, the actual work-start timestamp.
ALTER TABLE `Task` ADD COLUMN `startDate` DATETIME(3) NULL;
