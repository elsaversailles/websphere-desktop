-- AlterTable: mark where a calendar event came from and (for Outlook) its Graph event id.
ALTER TABLE `CalendarEvent`
  ADD COLUMN `source` ENUM('websphere', 'outlook') NOT NULL DEFAULT 'websphere',
  ADD COLUMN `externalId` VARCHAR(191) NULL;

-- One mirrored row per (owner, source, external event), so re-syncing updates in place instead of duplicating.
CREATE UNIQUE INDEX `CalendarEvent_ownerId_source_externalId_key` ON `CalendarEvent`(`ownerId`, `source`, `externalId`);

-- AlterTable: add the Outlook notification type.
ALTER TABLE `Notification` MODIFY `type` ENUM('task_assignment', 'task_update', 'project_change', 'group_activity', 'announcement', 'deadline_reminder', 'delay_risk', 'ai_suggestion', 'ticket_update', 'outlook') NOT NULL;

-- AlterTable: store the Microsoft Graph delta link so each poll fetches only changed events.
ALTER TABLE `ToolConnection` ADD COLUMN `deltaLink` TEXT NULL;
