ALTER TABLE `ToolConnection` DROP FOREIGN KEY `ToolConnection_provider_fkey`;
ALTER TABLE `ConnectedTool` MODIFY `provider` ENUM('google', 'microsoft', 'notion', 'trello', 'asana', 'canva') NOT NULL;
ALTER TABLE `ToolConnection` MODIFY `provider` ENUM('google', 'microsoft', 'notion', 'trello', 'asana', 'canva') NOT NULL;
ALTER TABLE `ToolConnection` ADD CONSTRAINT `ToolConnection_provider_fkey` FOREIGN KEY (`provider`) REFERENCES `ConnectedTool`(`provider`) ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO `ConnectedTool` (`id`, `provider`, `name`, `category`)
VALUES (UUID(), 'notion', 'Notion', 'collaboration');
