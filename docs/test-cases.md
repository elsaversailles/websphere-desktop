# WebSphere automated test specification

This document describes every automated test in the repository. For each test it gives the unit under test, the fixture state, the action performed, and the assertions that decide pass or fail.

- **Scope:** 56 unit tests in 11 files across `apps/api`, `apps/web` and `packages/shared`.
- **Framework:** Vitest 2.1.9, Node environment (no jsdom).
- **External services:** none. MySQL, Redis, SMTP, the push service and `fetch` are replaced with spies, so the suites run without Docker or a `.env` file. Integration testing against live services is covered separately in [TESTING.md](../TESTING.md).

## 1. Summary

| ID prefix | File | Unit under test | Tests |
|---|---|---|---|
| API-AUTH | `apps/api/src/auth-lifecycle.spec.ts` | `AppService` password change, reset and registration | 8 |
| API-PROJ | `apps/api/src/project-create.spec.ts` | `AppService.createProject` | 3 |
| API-RT | `apps/api/src/realtime.gateway.spec.ts` | `RealtimeGateway` | 7 |
| API-POLL | `apps/api/src/poll-window.spec.ts` | `AppService` timed voting | 12 |
| API-TKT | `apps/api/src/support-ticket.spec.ts` | `AppService` support tickets | 8 |
| API-ICE | `apps/api/src/app.controller.spec.ts` | `AppController.iceServers` | 2 |
| API-TURN | `apps/api/src/turn.service.spec.ts` | `TurnService.iceServers` | 2 |
| API-PUSH | `apps/api/src/push.service.spec.ts` | `PushService.deliver` | 2 |
| API-STOR | `apps/api/src/local-storage.service.spec.ts` | `LocalStorageService.saveAvatar` | 2 |
| WEB-AUTH | `apps/web/src/api.spec.ts` | `request()` token refresh | 4 |
| SHR-VAL | `packages/shared/src/profile.spec.ts` | Zod request schemas | 6 |

## 2. Running the tests

Install dependencies once with `pnpm install`. Every command runs once and exits.

| Goal | Command | Run from |
|---|---|---|
| All packages | `pnpm test` (Turborepo runs each package's `test` script) | repo root |
| One package | `pnpm --filter @websphere/api test` (or `@websphere/web`, `@websphere/shared`) | repo root |
| One file | `npx vitest run src/project-create.spec.ts` | package folder |
| Tests matching a name | `npx vitest run -t "presence provider"` | package folder |
| Print every test name | `npx vitest run --reporter=verbose` | package folder |

`npx vitest` without `run` starts watch mode and does not exit. Use it only during local development, not in CI.

A passing run ends with `Tasks: 6 successful, 6 total` from Turborepo, and with `Tests 46 passed`, `4 passed` and `6 passed` for the api, web and shared packages.

## 3. Test harness conventions

**Service construction without Nest DI.** Most API suites build the service with `Object.create(AppService.prototype)` and then assign spies for `prisma`, `redis`, `config`, `email`, `notify`, `audit` and `member`. This skips the Nest constructor and its real dependencies, so each test controls exactly what every collaborator returns.

**Assertions on Prisma calls.** These tests do not read stored data back. They check the arguments passed to the Prisma spies (for example `create.mock.calls[0][0].data`), so the database contract is what gets verified, not database behaviour.

**Real cryptography.** Password hashing uses the real `argon2` library, and `verify()` is used to confirm that the stored hash matches the new password. HMAC and SHA-256 values are computed with `node:crypto` and compared exactly.

**Web globals.** `apps/web/src/api.ts` reads `sessionStorage` when it is first imported. The web suite therefore stubs `sessionStorage`, `window`, `CustomEvent` and `fetch` with `vi.stubGlobal`, then calls `vi.resetModules()` and re-imports the module for each test so every test starts with clean module state.

## 4. API tests

### 4.1 Authentication lifecycle (`auth-lifecycle.spec.ts`)

Covers guided password change, locked-account password reset, and registration gated by a one-time code.

**API-AUTH-01: Locked accounts cannot use the guided password change**
- **Unit:** `AppService.changePassword`
- **Fixture:** the user record has `status: 'locked'`, and its `passwordHash` is a placeholder string that is not a valid hash.
- **Action:** `changePassword({ id: 'user-1' }, 'old', 'Valid!Pass9', 'Valid!Pass9')`
- **Expected:** rejects with HTTP status **423**. The status check must run first: an `argon2.verify` call against the placeholder hash would throw a different error.

**API-AUTH-02: A mismatched confirmation does not consume the reset token**
- **Unit:** `AppService.resetPassword`
- **Fixture:** default spies.
- **Action:** `resetPassword(<64-char token>, 'Valid!Pass9', 'different')`
- **Expected:** rejects with an `HttpException`, and `redis.take` is **never called**. A user who mistypes the confirmation keeps a usable reset link.

**API-AUTH-03: A wrong current password is rejected**
- **Unit:** `AppService.changePassword`
- **Fixture:** an active user whose `passwordHash` is a real argon2 hash of `Old!Pass9`.
- **Action:** `changePassword(..., 'Wrong!Pass9', 'Valid!Pass9', 'Valid!Pass9')`
- **Expected:** rejects with `response.code === 'PASSWORD_INCORRECT'`.

**API-AUTH-04: A valid change updates the hash and signs out other sessions**
- **Unit:** `AppService.changePassword`
- **Fixture:** an active user with a real hash of `Old!Pass9`; `prisma.user.update` is a spy.
- **Action:** `changePassword(..., 'Old!Pass9', 'Valid!Pass9', 'Valid!Pass9')`
- **Expected:**
  - resolves to `{ ok: true }`
  - the `passwordHash` written to the database verifies against `Valid!Pass9` with argon2
  - `tokenVersion` is written as `{ increment: 1 }`, which invalidates every access token issued before the change
  - `redis.delete` is called to revoke the stored refresh sessions

**API-AUTH-05: Reset tokens are issued only for locked accounts**
- **Unit:** `AppService.forgot`
- **Fixture:** `findUnique` returns a user with `status: 'locked'`. The email transport is stubbed to return `false` (not sent).
- **Action:** `forgot('locked@example.edu')`
- **Expected:**
  - `result.ok` is `true`
  - `result.resetToken` is 64 characters long
  - `redis.set` is called **twice**: once for the token-to-user mapping and once for the user-to-token pointer that lets a later request replace an earlier token
  - `email.sendPasswordReset` receives the same address and token

**API-AUTH-06: Redeeming the reset token unlocks the account**
- **Unit:** `AppService.resetPassword`
- **Fixture:** `redis.take` resolves to `'user-1'`, meaning the token is valid.
- **Action:** `resetPassword(<64-char token>, 'Valid!Pass9', 'Valid!Pass9')`
- **Expected:**
  - resolves to `{ ok: true }`
  - the update data contains `status: 'active'`, `lockedAt: null`, `failedLogins: 0` and `tokenVersion: { increment: 1 }`
  - the new `passwordHash` verifies against `Valid!Pass9`
  - `redis.take` is called **exactly once**. Because `take` reads and deletes in one step, the token cannot be redeemed a second time.

**API-AUTH-07: Registration starts by emailing a one-time code**
- **Unit:** `AppService.sendRegistrationOtp`
- **Fixture:** no existing user with that email; the rate-limit counter returns 1 (under the limit of 3); the code TTL is 600 s.
- **Action:** `sendRegistrationOtp('New.Member@Example.edu')`
- **Expected:**
  - `verificationId` matches `/^[a-f0-9]{64}$/`
  - the email is sent to the **lowercased** address with a code matching `/^\d{6}$/`
  - `redis.set` stores the pending verification under a key that contains the `verificationId`, with a TTL of **600** seconds

**API-AUTH-08: An account is created only with the matching code**
- **Unit:** `AppService.register`
- **Fixture:** Redis holds `{ email, codeHash }`, where `codeHash` is `sha256("<verificationId>:123456")`. `issue()` is stubbed to return tokens.
- **Action:** `register({ ..., verificationId, verificationCode: '123456' })`
- **Expected:**
  - resolves with `user.email === 'new@example.edu'`
  - the stored `passwordHash` verifies against `Valid!Pass9`
  - neither `verificationCode` nor `verificationId` appears in the `user.create` data, so the request fields are not passed through to the `User` table

### 4.2 Project creation (`project-create.spec.ts`)

Regression suite for the production error `Unknown argument 'memberIds'`, which made every `POST /projects` fail. `projectSchema` defaults `memberIds` to `[]`, so the field was always present and was spread straight into `prisma.project.create()`.

Shared fixture: `prisma.project.create` and `member` are spies, and the caller is `{ id: 'leader' }`.

**API-PROJ-01: memberIds becomes the members relation, not a column**
- **Action:** create a project with `memberIds: ['member-1']`.
- **Expected:**
  - the `create` data has **no `memberIds` property**
  - `title` and `createdBy` (`'leader'`) are passed through
  - `members.create` is `[{ userId: 'leader', role: 'Project_Leader' }, { userId: 'member-1', role: 'Project_Member' }]`

**API-PROJ-02: The key is stripped even when it holds the schema default**
- **Action:** create a project with `memberIds: []`.
- **Expected:** no `memberIds` in the data, and `members.create` holds only the creator as `Project_Leader`. This is the case that broke every request in production.

**API-PROJ-03: The creator is not added twice**
- **Action:** create a project with `memberIds: ['leader', 'member-1']`.
- **Expected:** `members.create` contains `leader` exactly once, as `Project_Leader`, followed by `member-1`. A duplicate row would break the `(projectId, userId)` unique constraint.

### 4.3 Realtime gateway (`realtime.gateway.spec.ts`)

Covers socket authentication, room authorization, presence, and call admission. The fake socket records calls to `join`, `leave`, `to` and `disconnect`. The `DomainEventsService` stub exposes `onNotification`, `onPollTally` and `registerPresenceProvider`.

**API-RT-01: The Redis adapter is installed on the underlying server**
- **Unit:** `RealtimeGateway.afterInit`
- **Fixture:** `redis.duplicateClient` returns a publisher and a subscriber. The namespace exposes `server.adapter` as a spy.
- **Expected:** both clients call `connect()` once, and `server.adapter` receives an adapter factory. Without this adapter, events would not reach sockets connected to other API instances.

**API-RT-02: Presence tracks connect and disconnect**
- **Unit:** `handleConnection`, `handleDisconnect`, and the registered presence provider
- **Fixture:** `app.caller` resolves to `{ id: 'user-1' }`. The test captures the provider function the gateway passes to `registerPresenceProvider`.
- **Steps and expected values:**
  1. Before any connection, the provider returns `[]`.
  2. After `handleConnection` with a token, it returns `['user-1']`.
  3. After `handleDisconnect`, it returns `[]` again.
- **Why:** the dashboard's Online card reads presence through this provider.

**API-RT-03: Sockets with an invalid JWT are disconnected**
- **Fixture:** `app.caller` rejects.
- **Expected:** `socket.disconnect(true)` is called. The `true` argument closes the underlying connection, not just the namespace.

**API-RT-04: Group rooms require membership**
- **Unit:** `groupJoin`
- **Expected:** resolves to `{ ok: true }`, `app.member('group-1', 'user-1')` is checked, and the socket joins `group:group-1`.

**API-RT-05: Denied project scope returns a structured acknowledgement**
- **Unit:** `projectJoin`
- **Fixture:** `projectMember` throws `ForbiddenException({ code: 'RBAC_FORBIDDEN', message: 'Denied' })`.
- **Expected:** the gateway returns `{ ok: false, error: { code: 'RBAC_FORBIDDEN', message: 'Denied' } }` and does not throw. The client receives an error it can act on instead of a dropped acknowledgement.

**API-RT-06: Starting a call invites the group without media passing through the server**
- **Unit:** `callJoin`
- **Fixture:** the call room is empty (`fetchSockets` returns `[]`).
- **Expected:**
  - returns `{ ok: true, participants: [], hostSocketId: 'socket-1', raisedHandSocketIds: [] }`; the first participant becomes host
  - the socket joins `call:group-1`
  - `call:invite` is emitted to `group:group-1` with `{ groupId: 'group-1', kind: 'video' }`
  - the result contains only signalling metadata and no media stream, which is consistent with the peer-to-peer WebRTC design

**API-RT-07: A seventh participant is refused**
- **Fixture:** `fetchSockets` returns six sockets.
- **Expected:** returns `{ ok: false, error: { code: 'CALL_FULL', message: 'This call has reached its six-participant limit' } }`, and `socket.join` is **not called**. The limit is checked before the socket enters the room.

### 4.4 Timed group voting (`poll-window.spec.ts`)

Covers vote deadlines, early closing by a leader, the background sweep that closes expired polls, and opening new polls.

Shared fixture: a poll `poll-1` in `group-1` ("Capstone") with one option. `ideaPoll.updateMany` returns `{ count: closeCount }` (default 1). `notify` and `events.emitPollTally` are spies. The group members are `leader-1` and `member-1`.

**API-POLL-01: Votes are accepted before the deadline**
- **Fixture:** `closesAt` is one hour from now.
- **Expected:** `vote.upsert` is called once, and `ideaPoll.updateMany` is not called (the poll is not closed).

**API-POLL-02: A late vote closes the poll as timed out**
- **Fixture:** `closesAt` was one second ago.
- **Expected:**
  - the vote rejects with **409**, and `vote.upsert` is not called
  - `updateMany` is called with `where: { id, open: true }` and `data: { open: false, closedAt: closesAt, closedBy: null }`. `closedAt` is set to the deadline, not the time of the late vote.
  - `notify` is called **once**, with "Voting time is up in “Capstone” — see the results"
  - `emitPollTally` broadcasts the tally with `open: false`

**API-POLL-03: Votes are refused on a poll the leader closed**
- **Fixture:** `open: false`, `closedBy: 'leader-1'`.
- **Expected:** rejects with **409** and records no vote.

**API-POLL-04: When two closes race, only the winner announces it**
- **Unit:** `closePollRecord`
- **Fixture:** `updateMany` returns `{ count: 0 }`, meaning another caller already closed the poll.
- **Expected:** returns `false`, and neither `notify` nor `emitPollTally` is called. The `open: true` condition in the `where` clause works as an atomic compare-and-set, so the group gets exactly one announcement.

**API-POLL-05: A leader can close the poll early**
- **Unit:** `closePoll`
- **Fixture:** the deadline is five hours away.
- **Expected:**
  - leadership is checked with `member('group-1', 'leader-1', true)`
  - the update data includes `open: false` and `closedBy: 'leader-1'`
  - `notify` goes to `['leader-1', 'member-1']` with "Voting in “Capstone” was closed by the group leader"
  - the result includes `pollId: 'poll-1'`

**API-POLL-06: Non-leaders cannot close the poll**
- **Fixture:** `member` rejects with status 403.
- **Expected:** rejects with **403**, and `updateMany` is never called.

**API-POLL-07: The sweep closes every expired poll at its deadline**
- **Unit:** `closeExpiredPolls`
- **Fixture:** `findMany` returns `poll-a` and `poll-b`, both expired one minute ago.
- **Expected:**
  - returns `2`
  - the query filters on `{ open: true, closesAt: { lte: <now> } }`
  - `updateMany` runs for `poll-a` and then `poll-b`, with `closedAt` set to the stored deadline and `closedBy: null`

**API-POLL-08: An expired poll reads as closed before the sweep runs**
- **Unit:** `tally`
- **Fixture:** `open: true` in the database, but `closesAt` was one second ago.
- **Expected:** the tally reports `open: false`, `closedReason: 'expired'`, and `closedAt` equal to `closesAt`. Clients see the correct state even when the sweep has not run yet.

**API-POLL-09: The duration sets the deadline and is announced**
- **Unit:** `openPoll`
- **Action:** open a poll with `durationHours: 12`.
- **Expected:**
  - `closesAt` is between 12 hours and 12 hours plus 5 seconds after the call
  - only the other members are notified (`where: { groupId: 'group-1', userId: { not: 'leader-1' } }`)
  - the message is "A vote opened in “Capstone” — voting closes in 12 hours"

**API-POLL-10: Without a duration the poll has no deadline**
- **Action:** open a poll with `durationHours: null`.
- **Expected:** `closesAt` is `null`, and the message is "A vote opened in “Capstone”" with no deadline mentioned.

**API-POLL-11: Only one poll can run per group**
- **Fixture:** a running poll with a deadline one hour away.
- **Expected:** opening another poll rejects with **409**, and `ideaPoll.create` is not called.

**API-POLL-12: An expired poll does not block a new one**
- **Fixture:** a poll that is still `open: true` in the database but expired one second ago.
- **Expected:** the stale poll is closed first (with `closedAt` set to its deadline and `closedBy: null`), then `ideaPoll.create` is called once.

### 4.5 Support tickets (`support-ticket.spec.ts`)

Covers routing new tickets to administrators and notifying requesters of changes.

Shared fixture: the existing ticket `ticket-1` was submitted by `member-1`, has subject "Cannot log in", status `pending`, and no response. Two active administrators exist (`admin-1`, `admin-2`).

**API-TKT-01: New tickets reach every administrator**
- **Unit:** `ticket`
- **Expected:** `notify` is called once with recipients `['admin-1', 'admin-2']`, type `ticket_update`, a message containing the subject, and the related reference `('ticket-1', 'ticket')`.

**API-TKT-02, 03, 04: Status changes notify the requester** (one parameterised test, run three times)
- **Unit:** `updateTicket`

| ID | New status | Label in the message |
|---|---|---|
| API-TKT-02 | `in_progress` | In Progress |
| API-TKT-03 | `resolved` | Completed |
| API-TKT-04 | `rejected` | Declined |

- **Expected:** the update data is exactly `{ status }`, and the requester receives "Your request “Cannot log in” is now <label>". The stored enum values are mapped to user-facing wording.

**API-TKT-05: A reply notifies the requester even without a status change**
- **Action:** status stays `pending`; response is "Looking into it".
- **Expected:** the response is saved, and the message is "The administrator replied to your request “Cannot log in”".

**API-TKT-06: Saving with no changes sends nothing**
- **Fixture:** the ticket is already `in_progress` with the response "On it".
- **Action:** save the same values again.
- **Expected:** neither `notify` nor `audit.log` is called, so a repeated save does not send duplicate notifications or write audit entries.

**API-TKT-07: An empty reply clears the stored response**
- **Fixture:** the existing response is "Old reply".
- **Action:** save with `response: ''`.
- **Expected:** the update writes `response: null`, not an empty string.

**API-TKT-08: Updates require an administrator and an existing ticket**
- **Expected:** a `Project_Member` caller gets **403**. An administrator updating a ticket that does not exist gets **404**.

### 4.6 ICE servers endpoint (`app.controller.spec.ts`)

**API-ICE-01: Relay credentials are returned only to group members**
- **Unit:** `AppController.iceServers`
- **Expected:** resolves to `{ iceServers: [...] }`. It checks `member('group-1', 'user-1')` before calling `turn.iceServers('user-1')`.

**API-ICE-02: Non-members get no relay details**
- **Fixture:** `member` rejects with `ForbiddenException`.
- **Expected:** the call rejects with `ForbiddenException`, and `turn.iceServers` is **never called**, so no TURN credential is generated for a caller outside the group.

### 4.7 TURN credentials (`turn.service.spec.ts`)

**API-TURN-01: Credentials expire and the secret is never returned**
- **Unit:** `TurnService.iceServers('user-1', 1_000_000)`
- **Fixture:** production config with host `turn.websphere.test` and a 3600 s TTL. The current time is fixed at 1,000,000 ms (1,000 s).
- **Expected:**
  - the username is `4600:user-1`, which is the expiry time (1,000 + 3,600 seconds) followed by the user ID, as the coturn REST API format requires
  - the credential is `base64(HMAC-SHA1(sharedSecret, username))`
  - three relay URLs are returned: TURN over UDP and TCP on port 3478, and TURNS over TCP on port 5349, plus a STUN URL
  - the serialised output does **not contain the shared secret**

**API-TURN-02: Development falls back to STUN only**
- **Fixture:** `NODE_ENV=development` with no TURN host or secret.
- **Expected:** returns only `[{ urls: 'stun:stun.l.google.com:19302' }]`.

### 4.8 Web push (`push.service.spec.ts`)

The `web-push` module is replaced with `vi.mock`, so no network request is made.

**API-PUSH-01: Each subscribed device receives the notification**
- **Unit:** `PushService.deliver`
- **Fixture:** push is enabled for the user, and one subscription exists.
- **Expected:**
  - `setVapidDetails` is called with the configured subject and key pair
  - `sendNotification` is called with the subscription endpoint and keys, a payload containing the message text, and `{ TTL: 3600 }`

**API-PUSH-02: Subscriptions the push service reports as gone are deleted**
- **Fixture:** `sendNotification` rejects with `{ statusCode: 410 }`.
- **Expected:** `pushSubscription.delete({ where: { id: 'subscription-1' } })` is called. HTTP 410 means the browser has unsubscribed, so the record should not be retried.

### 4.9 Avatar storage (`local-storage.service.spec.ts`)

This suite writes real files to a temporary directory created with `mkdtemp` and deletes it after the run.

**API-STOR-01: A real PNG is stored under a generated name**
- **Fixture:** a buffer that starts with the PNG signature `89 50 4E 47 0D 0A 1A 0A`.
- **Expected:** the returned URL matches `/^\/uploads\/[a-f0-9-]+\.png$/`, and the file on disk is byte-identical to the input. The uploaded file name `profile.png` is not used for storage.

**API-STOR-02: A non-image with an image extension is rejected**
- **Fixture:** the name is `profile.png` and the MIME type is `image/png`, but the content is the text "not an image".
- **Expected:** rejects with **400**. The file type is checked from its first bytes, not from the name or the client-supplied MIME type.

## 5. Web tests

### 5.1 Access-token refresh (`api.spec.ts`)

Regression suite for `AUTH_UNAUTHENTICATED` errors in tabs left open longer than the 15-minute access-token lifetime. Before this fix, the client exchanged its 30-day refresh token only during startup.

Shared fixture: `sessionStorage` is seeded with `ws_access: 'expired-access'`, `ws_refresh: 'refresh-1'`, a role, and a user. The `fetch` stub returns a scripted series of responses and records the method, path and `Authorization` header of each call.

**WEB-AUTH-01: An expired token is refreshed and the request is retried**
- **Responses:** `401 AUTH_UNAUTHENTICATED`, then a refresh returning `{ access: 'fresh-access', refresh: 'refresh-2' }`, then `200 { id: 'project-1' }`.
- **Action:** `request('/projects', { method: 'POST' })`
- **Expected:**
  - resolves to `{ id: 'project-1' }`
  - the calls happen in this order: `POST /api/projects`, `POST /api/auth/refresh`, `POST /api/projects`
  - the first attempt sends `Bearer expired-access`, and the retry sends **`Bearer fresh-access`**
  - `sessionStorage` afterwards holds `ws_access: 'fresh-access'` and `ws_refresh: 'refresh-2'`

**WEB-AUTH-02: Concurrent 401s share one refresh**
- **Responses:** three 401s, then one refresh, then success for every later call.
- **Action:** `/dashboard`, `/groups` and `/tasks/mine` are requested in parallel with `Promise.all`.
- **Expected:** exactly **one** `POST /api/auth/refresh` is made.
- **Why:** refresh tokens are single use and replaced on every exchange. If the server sees a used refresh token again, it increments the account's `tokenVersion`, which signs out every session. Three separate refreshes would therefore sign the user out.

**WEB-AUTH-03: A rejected refresh ends the session**
- **Responses:** every call returns 401, including the refresh.
- **Expected:** the request rejects with `sessionExpiredMessage`, and the `websphere:session-invalidated` event is dispatched, which sends the app back to the login screen.

**WEB-AUTH-04: No refresh is attempted without a refresh token**
- **Fixture:** only `ws_access` is stored.
- **Expected:** the request rejects with `sessionExpiredMessage`, and no request is made to `/api/auth/refresh`.

## 6. Shared tests

### 6.1 Request schemas (`profile.spec.ts`)

These tests check the Zod schemas that both the API and the web client use to validate requests.

**SHR-VAL-01: A valid profile update is accepted and trimmed**
- **Action:** `profileUpdateSchema.parse({ fullName: '  Ada Lovelace  ', ... })`
- **Expected:** returns the same object with `fullName` trimmed to `'Ada Lovelace'`.

**SHR-VAL-02 to 05: Invalid profile fields are rejected** (one parameterised test, run four times)

| ID | Input | Field reported in the first issue's path |
|---|---|---|
| SHR-VAL-02 | `{ fullName: '' }` | `fullName` |
| SHR-VAL-03 | `{ email: 'not-an-email' }` | `email` |
| SHR-VAL-04 | `{ institution: ' ' }` (whitespace only) | `institution` |
| SHR-VAL-05 | `{ course: 'x' }` (too short) | `course` |

- **Expected:** `safeParse` returns `success: false`, and the first issue's `path` contains the field being tested. This confirms the right field is reported, not just that validation failed.

**SHR-VAL-06: Password request shapes are accepted**
- **Expected:** `passwordForgotSchema`, `passwordChangeSchema` and `passwordResetSchema` each accept a well-formed payload. The reset token is 64 characters, and the password and confirmation match.

## 7. Known coverage gaps

| Area | Status |
|---|---|
| React UI components (dashboard cards, sidebar, modals, group chat) | No component or end-to-end tests. Changes were checked only through build output and the values in the compiled CSS. |
| `scripts/deploy-lightsail.sh` | The rollback-snapshot fix was checked with a throwaway shell harness that is not in the repo. There is no shell test runner. |
| Prisma migrations and real queries | All database access is stubbed. Migration correctness needs MySQL; see [TESTING.md](../TESTING.md). |
| Dashboard aggregation endpoints (`activityFeed`, `onlineTeammates`, `announcements`, `milestones`) | Not tested. These were checked only by building successfully. |
| `leaveGroup` (`POST /groups/:id/leave`) | Not tested, including the rule that blocks the last leader from leaving. |
