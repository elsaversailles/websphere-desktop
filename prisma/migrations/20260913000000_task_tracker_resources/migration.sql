-- Add the review state used by the task tracker and preserve the time a resource was linked.
ALTER TABLE `Task` MODIFY `status` ENUM('pending', 'ongoing', 'for_review', 'completed') NOT NULL DEFAULT 'pending';

ALTER TABLE `LinkedResource` ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
