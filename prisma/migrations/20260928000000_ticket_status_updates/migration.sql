-- AlterTable
ALTER TABLE `Notification` MODIFY `type` ENUM('task_assignment', 'task_update', 'project_change', 'group_activity', 'announcement', 'deadline_reminder', 'delay_risk', 'ai_suggestion', 'ticket_update') NOT NULL;

-- AlterTable
ALTER TABLE `SupportTicket` ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateIndex
CREATE INDEX `SupportTicket_userId_createdAt_idx` ON `SupportTicket`(`userId`, `createdAt`);
