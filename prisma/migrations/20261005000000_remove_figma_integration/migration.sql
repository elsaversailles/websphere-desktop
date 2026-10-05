-- Retire Figma and its encrypted credentials, links, and usage records before narrowing ProviderId.
DELETE lr FROM `LinkedResource` AS lr
INNER JOIN `ToolConnection` AS tc ON tc.`id` = lr.`connectionId`
WHERE tc.`provider` = 'figma';

DELETE tu FROM `ToolUsage` AS tu
INNER JOIN `ToolConnection` AS tc ON tc.`id` = tu.`connectionId`
WHERE tc.`provider` = 'figma';

DELETE FROM `ToolConnection` WHERE `provider` = 'figma';
DELETE FROM `ConnectedTool` WHERE `provider` = 'figma';

ALTER TABLE `ConnectedTool` MODIFY `provider` ENUM('google', 'microsoft', 'trello', 'asana', 'canva') NOT NULL;
ALTER TABLE `ToolConnection` MODIFY `provider` ENUM('google', 'microsoft', 'trello', 'asana', 'canva') NOT NULL;
