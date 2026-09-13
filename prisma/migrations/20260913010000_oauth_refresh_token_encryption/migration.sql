-- Each encrypted refresh token needs its own AES-GCM IV and authentication tag.
-- Earlier connections remain usable until their access token expires, then must reconnect.
ALTER TABLE `ToolConnection`
  ADD COLUMN `refreshIv` VARCHAR(191) NULL,
  ADD COLUMN `refreshAuthTag` VARCHAR(191) NULL;
