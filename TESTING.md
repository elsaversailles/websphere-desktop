# Verification status

The following test categories are intentionally not executed locally because they require backend services or externally provisioned credentials:

- Prisma migration and integration tests: MySQL 8.
- Socket.IO adapter, BullMQ, presence, notification, and `/health` integration tests: Redis.
- Local-avatar filesystem permissions, OpenAI, SES, VAPID, and OAuth adapter contract tests: their Linux instance path, credentials, or sandbox providers.

Once `.env` is created from `example.env`, start the service dependencies with `docker compose -f docker/docker-compose.yml up -d mysql redis`, then run `pnpm db:migrate`, `pnpm db:seed`, and the relevant test suites. Pure password, crypto, and workflow formula tests do not need backend services.
