-- Retire Figma and its encrypted credentials, links, and usage records before narrowing ProviderId.
DELETE lr FROM `LinkedResource` AS lr
INNER JOIN `ToolConnection` AS tc ON tc.`id` = lr.`connectionId`
WHERE tc.`provider` = 'figma';

DELETE tu FROM `ToolUsage` AS tu
INNER JOIN `ToolConnection` AS tc ON tc.`id` = tu.`connectionId`
WHERE tc.`provider` = 'figma';

DELETE FROM `ToolConnection` WHERE `provider` = 'figma';
DELETE FROM `ConnectedTool` WHERE `provider` = 'figma';

-- The provider columns are related by a foreign key, so temporarily remove it before changing
-- either enum and restore the same constraint after both columns use the narrowed enum.
ALTER TABLE `ToolConnection` DROP FOREIGN KEY `ToolConnection_provider_fkey`;
ALTER TABLE `ToolConnection` MODIFY `provider` ENUM('google', 'microsoft', 'trello', 'asana', 'canva') NOT NULL;
ALTER TABLE `ConnectedTool` MODIFY `provider` ENUM('google', 'microsoft', 'trello', 'asana', 'canva') NOT NULL;
ALTER TABLE `ToolConnection` ADD CONSTRAINT `ToolConnection_provider_fkey` FOREIGN KEY (`provider`) REFERENCES `ConnectedTool`(`provider`) ON DELETE RESTRICT ON UPDATE CASCADE;
