# WebSphere domain migration: desktop, backend, and mobile

Prepared: November 15, 2026 (Asia/Manila)

Migration: websphere.fun → websphere.cloud

Status: website/backend and Android migration implemented. iOS release and incoming .cloud mailbox setup are explicitly deferred by the user. See section 17 for execution status. Earlier inspection snapshots describe the pre-migration state.

## 1. Objective and migration rules

Make https://websphere.cloud the canonical website and https://websphere.cloud/api the API used by new mobile releases. Keep the current Lightsail application, database, Redis instance, uploads, and integration connections.

Prepare and verify the new domain first, release mobile updates second, and retire old endpoints only when client adoption permits it.

**Critical compatibility requirement:** installed mobile binaries currently contain https://websphere.fun/api. Website redirects alone will not migrate them. Keep the old API, Socket.IO, and uploads endpoints directly functional against the same backend until those installations have upgraded or an explicit end-of-support decision is made. A 24–48 hour website observation period is not a mobile compatibility deadline.

Preserve:

- Existing MySQL data and Compose project/volume names.
- Redis authentication sessions and pending OAuth/reset state.
- JWT secrets and CRYPTO_KEY_BASE64.
- OAuth application identities and credentials.
- Native package identifiers, signing credentials, EAS project, and push credentials.
- The websphere custom URL scheme.

No database schema migration is expected solely for this domain change. Audit stored URLs before deciding whether a narrowly scoped data update is necessary.

## 2. Inspection scope and evidence

Repositories inspected:

| Repository | Location | Role |
| --- | --- | --- |
| Desktop/backend | This repository: Websphere-Desktop | React/Vite, NestJS API, worker, Docker/Nginx, TURN |
| Mobile | ../websphere-mobile | Expo/React Native Android, iOS, and optional web export |

The apps/mobile directory in this repository is only a reserved placeholder. The actual mobile implementation is in the sibling repository.

Both repositories already have unrelated uncommitted changes. Implementation must preserve those changes and isolate the migration diff. Findings below describe the working trees inspected, not verified deployed artifacts.

The server at 18.142.207.66 was subsequently inspected over SSH; verified DNS resolution, active Nginx configuration, selected non-secret runtime settings, certificates, and persistence observations are recorded in section 16. Provider portals, EAS environment values, installed app distribution, store submission state, production data URLs, and end-to-end flows remain unverified.

### Desktop/backend findings

| File | Finding | Migration action |
| --- | --- | --- |
| [apps/web/src/api.ts](apps/web/src/api.ts) | REST defaults to /api; sockets default to the website origin | Keep relative routing; check for production build overrides |
| [apps/api/src/main.ts](apps/api/src/main.ts) | HTTP CORS splits WEB_ORIGIN on commas | Allow both origins during transition, with no spaces |
| [apps/api/src/realtime.gateway.ts](apps/api/src/realtime.gateway.ts) | Socket.IO also reads WEB_ORIGIN | Apply the same overlap configuration |
| [apps/api/src/app.service.ts](apps/api/src/app.service.ts) | First origin controls canonical destinations; explicit OAuth base supported | Put .cloud first at canonical cutover |
| [apps/api/src/email.service.ts](apps/api/src/email.service.ts) | Generates reset/confirmation links; support recipient hardcoded to support@websphere.fun | Add configurable SUPPORT_EMAIL; verify both link flows |
| [apps/api/src/oauth-callback.spec.ts](apps/api/src/oauth-callback.spec.ts) | Callback examples use .fun | Cover .cloud and overlap behavior |
| [docker/nginx.conf](docker/nginx.conf) | Domain-independent API/uploads/socket routes | Preserve paths and API trailing-slash behavior |
| [docker/docker-compose.yml](docker/docker-compose.yml) | Shared production env; Redis has no explicitly configured named persistence volume | Live Redis uses an anonymous /data volume with RDB snapshots; preserve it and avoid recreation during migration |
| [scripts/deploy-lightsail.sh](scripts/deploy-lightsail.sh) | Loads shared/.env; broader deployment includes infrastructure | Coordinate deployment with the cutover; do not assume only the web service changes |
| [apps/api/src/turn.service.ts](apps/api/src/turn.service.ts) | API supplies ICE servers from TURN configuration | Migrate relay hostname/certificate separately |
| [apps/web/public/site.webmanifest](apps/web/public/site.webmanifest) | Root-relative start URL and assets | No hardcoded domain replacement needed |

### Mobile findings

| File in ../websphere-mobile | Finding | Migration action |
| --- | --- | --- |
| app.config.ts | API fallback is .fun; exposes extra.apiUrl; determines native HTTP settings | Set fallback to https://websphere.cloud/api; retain HTTPS |
| src/lib/api.ts | DEFAULT_BASE is .fun; precedence is env → extra.apiUrl → default | Update fallback and domain example; test all configuration sources |
| eas.json | development, preview, production, maintenance-preview explicitly use .fun | Update all four; preserve preview-lan |
| .env.example | Localhost development example | Clarify local versus production examples; never blindly replace localhost |
| README.md | Production .fun examples; build-profile guidance disagrees with eas.json | Update URLs and correct build/distribution instructions |
| tests/qa-contracts.test.cjs | Escaped regular expression expects a .fun profile-update request | Update assertion and add meaningful URL-resolution coverage |
| src/lib/socket.tsx | Derives socket origin from the API configuration | Verify .cloud root /socket.io/, not /api/socket.io/ |
| src/lib/api.ts: absoluteUrl | Converts relative uploads using serverOrigin; preserves absolute URLs | Verify uploads and audit stored absolute .fun URLs |
| src/app/(user)/apitools.tsx | OAuth uses Linking.createURL('/apitools') and an auth browser session | Keep native scheme and verify browser-to-app return |
| src/lib/mobile-push.native.ts | Registers Expo token using the existing EAS project | Preserve project and credentials; verify registration via .cloud |
| src/lib/call.ts | Fetches ICE servers from the backend | Relay migration normally needs backend configuration, not another hardcoded mobile hostname |
| src/lib/backup-download.native.ts | Authenticated downloads use apiUrl | Verify downloads on .cloud and old binaries on .fun |
| src/app/_layout.tsx | Maintenance contact already uses support@websphere.cloud | Ensure that mailbox or forwarding destination actually works |

No expo-updates dependency or EAS Update configuration was found in the inspected mobile configuration. Plan for new native builds; do not assume an OTA deployment can change existing installations.

## 3. Target addresses and compatibility routing

| Address | Target behavior |
| --- | --- |
| https://websphere.cloud | Canonical application |
| https://www.websphere.cloud | Redirect to apex, preserving path and query |
| https://websphere.cloud/api/* | Existing API via current reverse proxy |
| https://websphere.cloud/socket.io/* | Existing Socket.IO service |
| https://websphere.cloud/uploads/* | Existing uploads |
| turn.websphere.cloud | Direct TURN endpoint after separate relay cutover |
| https://websphere.fun/api/* | Continue proxying directly for old native clients |
| https://websphere.fun/socket.io/* | Continue proxying directly for old native clients and existing browser tabs |
| https://websphere.fun/uploads/* | Continue serving existing clients and stored image URLs |
| Ordinary .fun page routes | Initially serve normally; later redirect to .cloud |

Configure compatibility locations before a catch-all page redirect. A server-level unconditional return can bypass intended location exceptions. Preserve old OAuth and email-confirmation GET routes while needed. Keep ACME challenge handling compatible with certificate renewal.

Do not depend on cross-domain HTTP redirects for API traffic. They can change method handling or lose authentication headers, and Socket.IO clients should connect to a functioning endpoint directly.

## 4. Phase A — preflight and recovery preparation

Owner: application/server maintainer, with domain/account owner for external settings.

1. Confirm the Lightsail static IP, production deployment directory, Compose project name, and current release.
2. Inventory active host Nginx virtual hosts, public aliases, TLS certificate names, and renewal hooks.
3. Record current production origins, callback base, mail sender, TURN/STUN settings, and deployment SSH target without putting secrets in this document or logs.
4. Inventory enabled OAuth integrations and their actual registered callbacks.
5. Check EAS account/environment values, current distributed APKs, TestFlight/App Store/Play releases, signing identity, and highest native build numbers.
6. Back up MySQL and uploaded files independently; securely save the environment and Nginx configuration. Confirm the backup can be read.
7. Keep the working deployment and old domain reachable throughout preparation.
8. If LIGHTSAIL_HOST uses the old domain, use a stable SSH hostname or static IP with verified known-host configuration before any relevant DNS removal.

Do not run docker compose down -v, rename the Compose project, rotate database passwords, flush Redis, or recreate the database as part of this migration.

Exit gate: actual deployment details and a recovery procedure are recorded; required accounts and credentials are available.

## 5. Phase B — DNS and certificates

Owner: domain owner for DNS; server maintainer for TLS.

| Record | Value | Requirement |
| --- | --- | --- |
| A @ | Current Lightsail static public IP | Main site |
| CNAME www | websphere.cloud | Canonical redirect served by Nginx |
| A turn | Current relay public IP | Direct access to coturn |
| AAAA | Only a working public IPv6 destination | Do not publish an unusable IPv6 route |
| Mail/verification records | Values supplied by the actual providers | Preserve and verify independently |

Use a short TTL such as 300 seconds where supported during migration. A lower TTL does not immediately expire records already cached under a previous TTL. Check CAA restrictions.

If changing nameservers, copy all necessary records first and coordinate any DNSSEC delegation changes. Pointing an A record and moving nameservers are different operations.

Issue certificates for websphere.cloud and www.websphere.cloud. Prepare the TURN certificate separately. Keep .fun certificates and renewal functional for legacy mobile traffic and HTTPS redirects.

DNS-01 can validate ownership through DNS TXT records before web traffic points at the server. HTTP-01 requires the challenge to be publicly reachable on port 80 after DNS points correctly. Automate renewal for the selected method. [Let's Encrypt challenge documentation](https://letsencrypt.org/docs/challenge-types/)

Exit gate: required names resolve correctly and .cloud HTTPS works without bypassing certificate validation.

## 6. Phase C — server preparation and canonical origin

First add .cloud virtual hosts that proxy to the existing http://127.0.0.1:8080. Initially leave .fun serving normally. Validate with nginx -t before reload.

Confirm REST, uploads, and Socket.IO routing at both Nginx layers. Preserve proxy_pass http://api:3000/ with its trailing slash: /api/auth/login must reach /auth/login.

Forward WebSocket Upgrade and Connection headers through host Nginx as well as the web-container Nginx. The repository's host example does not demonstrate those headers. Keep an appropriate idle timeout or heartbeat behavior. [Nginx WebSocket documentation](https://nginx.org/en/docs/http/websocket.html)

During preparation, keep .fun first if it must remain the canonical destination:

    WEB_ORIGIN=https://websphere.fun,https://websphere.cloud

At the deliberate canonical cutover, use:

    WEB_ORIGIN=https://websphere.cloud,https://websphere.fun
    OAUTH_CALLBACK_BASE_URL=https://websphere.cloud/api

Use comma-separated origins without spaces. Add a www origin only if it actually serves the application instead of redirecting.

The first WEB_ORIGIN generates password-reset and email-change destinations. OAUTH_CALLBACK_BASE_URL also affects email-change confirmation URLs, so test that endpoint alongside provider callbacks.

Load changed environment values by recreating affected application containers, not merely restarting them. API is affected by origins/callback/support changes; API and worker are affected by SES_FROM changes. Build frontend changes only if needed; verify no absolute .fun override is embedded in deployed Vite output.

Coordinate with the existing workflow, which performs a broader service deployment and Prisma migration checks. Inspect the proposed release for unrelated migrations before running it. Avoid pulling/recreating Redis during the domain cutover.

Before DNS propagation, use a local hosts override or curl --resolve against the known server IP to inspect hostname routing and valid HTTPS. This does not replace public DNS or external-provider callback tests.

Exit gate: both domains reach the same data and services; .cloud is the configured source of new links.

## 7. Phase D — OAuth, email, and stored links

### OAuth registration

Register the new callback on the existing application for each enabled provider:

    https://websphere.cloud/api/integrations/google/callback
    https://websphere.cloud/api/integrations/microsoft/callback
    https://websphere.cloud/api/integrations/notion/callback
    https://websphere.cloud/api/integrations/trello/callback
    https://websphere.cloud/api/integrations/asana/callback
    https://websphere.cloud/api/integrations/canva/callback

Keep old registered callbacks during overlap wherever supported. For a provider allowing only one callback, coordinate its replacement and communicate that an already-open authorization may need retrying.

Google also needs review of applicable authorized JavaScript origins, authorized domains, consent-screen website/privacy/support URLs, and Google Picker API-key website restrictions. Add .cloud restrictions before removing .fun. Google requires the redirect URI to match its registered value. [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server)

The backend stores the original callback URL and return URL in Redis for each OAuth flow for 600 seconds. Preserve Redis and the old callback route for at least that interval after the last old flow was created, plus margin. Longer retention is useful for rollback and legacy clients.

Native mobile initiates connections for Google, Microsoft, Trello, and Asana in the inspected UI. Backend support also includes Notion and Canva; test whichever integrations are enabled in production without broadening mobile integration scope.

Keep the native websphere scheme. Providers return to the HTTPS backend callback, then the backend redirects to the stored native return URL. Do not replace provider callback registrations with websphere:// URLs.

### Email and support

1. Add SUPPORT_EMAIL to desktop API configuration and use it instead of the hardcoded recipient.
2. Keep a working recipient until support@websphere.cloud is provisioned; the mobile maintenance UI already advertises that new address.
3. If changing SES_FROM, verify the .cloud identity in the active SMTP region and publish DKIM plus the chosen DMARC/MAIL FROM/SPF settings.
4. Verify support mailbox receiving/forwarding separately. SES sender verification alone does not create a support inbox.
5. Update SES_FROM for API and worker only after verification; preserve the old identity during rollback.
6. Update VAPID_SUBJECT if it contains an obsolete contact address, while retaining VAPID keys.

SES identities are regional. [AWS SES identity documentation](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html)

Test registration codes, password resets, email-change confirmations, account-status messages, deactivation requests, and queued task/notification email.

### Stored URLs

Audit user avatar URLs, linked resources, rich-text/shared links, releaseManifestUrl settings, and published app download/support URLs for absolute .fun references. Current avatar storage creates relative /uploads paths; preserve those.

Update only URLs owned by WebSphere and intended to move. Do not change user email addresses, external provider resource URLs, historical logs, or every database string containing the old domain.

Exit gate: new and existing integration connections work; all required email paths and support receiving work.

## 8. Phase E — mobile configuration and native releases

All changes in this section are planned for ../websphere-mobile; this document does not modify that repository.

### Configuration patch

1. Change the API fallback in app.config.ts to https://websphere.cloud/api.
2. Change DEFAULT_BASE and the production example in src/lib/api.ts to the same URL.
3. Update development, preview, production, and maintenance-preview in eas.json. Keep the intentional preview-lan HTTP target.
4. Check actual EAS environment variables for conflicting values and ensure the resolved config and JS bundle agree on .cloud.
5. Update the local ignored .env only when it is intended to use production; retain intentional developer LAN settings.
6. Clarify .env.example with separate production and local examples.
7. Update README deployment examples and the escaped .fun expectation in tests/qa-contracts.test.cjs.

EXPO_PUBLIC values are substituted into the JS bundle during bundling. Server environment changes cannot retarget an installed binary. Existing releases need a new distributed build under the inspected setup. [Expo environment-variable documentation](https://docs.expo.dev/guides/environment-variables/)

Keep the existing URL relationships:

    apiBase       = https://websphere.cloud/api
    serverOrigin  = https://websphere.cloud
    socketBaseUrl = https://websphere.cloud
    upload URL    = https://websphere.cloud/uploads/<file>

Do not add /api to Socket.IO or uploads. absoluteUrl intentionally preserves existing absolute URLs; keep legacy .fun uploads available while auditing them.

### App identity, sessions, and notifications

Keep android.package and ios.bundleIdentifier as com.websphere.mobile. Keep scheme websphere, the existing EAS project, Android signing lineage, Apple team identity, APNs/FCM configuration, and SecureStore keys.

Unlike browser localStorage, native SecureStore keys are not keyed by the API hostname. An in-place upgrade should retain the session if storage, server secrets, and Redis sessions are preserved. Test an authenticated upgrade from a real old build without uninstalling; do not promise retention without that test. Uninstall/reinstall is not equivalent to an app update.

Do not require native users to grant notification permission again solely because the API domain changed. Re-register the current token through .cloud and verify delivery. Expo states that Expo push tokens remain stable across normal app upgrades; preserving app identity is important. [Expo push FAQ](https://docs.expo.dev/push-notifications/faq/)

Keep websphere:// return handling and test the actual URL produced by Linking.createURL('/apitools') in signed Android and iOS builds. No iOS associatedDomains or Android intentFilters were found in the inspected config, so universal/app links are not a required domain replacement here. Adding them would be a separate feature. [Expo deep-link documentation](https://docs.expo.dev/linking/into-your-app/)

### Build numbering and distribution

The inspected config has app version 1.0.0, iOS buildNumber 7, Android versionCode 1, and local version management. Determine the highest uploaded/distributed numbers before choosing replacements; do not assume the source values are current store maxima.

Increment native build numbers above the existing uploaded versions and choose an appropriate visible release version. [Expo version documentation](https://docs.expo.dev/build-reference/app-versions/)

The actual production Android profile currently builds an APK. The build:aab script selects that same profile, so its name does not guarantee an AAB. README also mentions a production-apk profile that is absent.

- For sideloaded distribution: retain APK output and signing compatibility.
- For Google Play: create or select an explicit app-bundle profile and align the script/documentation before submission.
- For iOS: build with the current production identity, distribute through TestFlight first, then the intended production channel.

Do not set up OTA updates or change app identity as an incidental part of this migration.

Exit gate: signed preview builds target .cloud, preserve an existing installation's session where valid, and pass physical-device checks.

## 9. Phase F — TURN migration

Decouple this from the first website/mobile API cutover. New mobile clients can initially use the working old relay because they fetch ICE configuration from the backend.

1. Resolve turn.websphere.cloud to the actual relay IP.
2. Issue a certificate covering the new hostname.
3. Preserve the old hostname's certificate coverage while clients or active configurations still use it; use a certificate covering both during overlap if necessary.
4. Set TURN_HOST=turn.websphere.cloud and TURN_CERT_NAME to the actual certificate directory name.
5. Update TURN_STUN_URL if explicitly set to the old hostname.
6. Preserve TURN_REALM=websphere, shared secret, external IP, and relay ports unless the actual infrastructure requires otherwise.
7. Confirm TCP/UDP 3478, TCP/UDP 5349, and UDP 49160–49200 remain reachable.
8. Keep direct TURN routing; do not put it behind the ordinary HTTP reverse proxy.
9. Recreate/reload coturn in a low-usage window; doing so can interrupt calls.
10. Retain the certificate renewal deploy hook that reloads coturn.

Test a real call across different networks, including mobile data, and confirm relay use rather than assuming a successful local call exercised TURN. Include desktop-to-mobile and mobile-to-mobile.

Exit gate: new relay credentials, UDP/TCP relay paths, and TLS relay connectivity work.

## 10. Verification and release gates

These are future implementation checks. No builds or application tests were run for this planning-only change.

### Repository checks after implementation

Desktop/backend:

    pnpm --filter @websphere/api test
    pnpm --filter @websphere/web test
    pnpm --filter @websphere/api build
    pnpm --filter @websphere/web build

If changing worker configuration or behavior, also run its relevant tests/build. Check Nginx configuration and Compose validation using the intended environment without printing secrets.

Mobile:

    npm run verify
    npm run test:qa

Inspect the resolved Expo config for each changed profile, and export/build with the intended environment. Account for existing unrelated working-tree failures separately; do not silently attribute them to the migration or claim the release passed.

Add focused mobile tests for environment/extra/default precedence, trailing slashes, REST URLs, socket origin, relative upload URLs, and intentional local development configuration. Keep existing refresh/profile-update regression coverage.

### Functional matrix

| Scenario | Clients/conditions | Pass criterion |
| --- | --- | --- |
| TLS and health | .cloud and .fun | Valid certificates; /api/health succeeds without unexpected redirects |
| Website routing | Apex, www, refresh on a deep route | Correct canonical destination; path/query retained |
| Authentication | New web origin; updated native app; old native app | Login, refresh, logout, role checks work |
| Native upgrade | Existing signed app upgraded in place | Saved valid session restored and refreshed against .cloud |
| API writes | Old .fun app and new .cloud app | Same records appear in both; authenticated POST/PATCH work |
| Images/uploads | Existing avatars plus new upload | Correct root URL, no missing image or auth regression |
| Chat | Old mobile, new mobile, desktop | Messages/acks delivered, reconnect restores group participation |
| OAuth | Each enabled provider; signed iOS/Android | New callback accepted; native browser session returns to app |
| In-flight OAuth | Begin on old configuration, finish during overlap | Original callback/state still accepted within its TTL |
| Email | API and worker paths | Delivery succeeds; new links target .cloud |
| Existing email links | Old reset/confirmation links within TTL | Reach the correct handler; token/query preserved |
| Browser push | Fresh .cloud permission/subscription | Notification arrives and opens the website |
| Native push | Existing upgrade and fresh install; background/closed | Registration succeeds; alert opens correct item |
| Calls | Desktop/mobile, mobile/mobile, Wi-Fi/mobile data | Invite, media, reconnect, mute, and relay behavior work |
| Backup download | Administrator on Android/iOS | Authenticated file download succeeds |
| Maintenance contact | Mobile maintenance screen | support@websphere.cloud receives mail |

Use distinct real sessions for parallel clients. Do not clone a single-use refresh token across devices to simulate compatibility.

## 11. Coordinated execution order

| Order | Action | Gate |
| --- | --- | --- |
| 1 | Inventory production and save recovery artifacts | Current config, data, certificates, and release known |
| 2 | Prepare source/config changes in both repositories | Reviewable migration-only diffs; checks pass |
| 3 | Prepare .cloud DNS, TLS, OAuth registrations, and support inbox | New external dependencies ready |
| 4 | Serve both domains through the same backend | .fun legacy functionality preserved |
| 5 | Put .cloud first in origins and switch explicit callback base | .cloud website, links, callbacks, and email verified |
| 6 | Build signed .cloud Android/iOS previews | Real device and in-place upgrade matrix passes |
| 7 | Publish/distribute mobile updates | Existing signing/project identity retained |
| 8 | Introduce temporary .fun page redirects | API/socket/uploads/callback exceptions remain working |
| 9 | Migrate TURN in a separate low-usage window | Cross-network relay checks pass |
| 10 | Observe, then make page redirects permanent | No unresolved authentication, callback, mail, or media regression |
| 11 | Retire legacy service routes only after adoption review | Supported installed builds no longer depend on .fun |

Allow a 24–48 hour initial observation window after canonical cutover. Store review and mobile adoption may take much longer; do not tie legacy endpoint retirement to that initial window.

Before publication, update any actual store/support/privacy/marketing/download URLs containing .fun. Check distribution-channel status in the live consoles; local build logs do not establish approval or availability.

## 12. Monitoring and retirement

Monitor by request hostname: API errors and latency, auth/refresh failures, callback failures, mail errors, socket disconnects, and TURN failures. Observe legacy host usage without logging bearer tokens, OAuth codes/state, reset tokens, or sensitive query strings.

The inspected mobile client does not provide a dedicated app-version header. Use available host-level traffic plus distribution/adoption information; optional version telemetry would be a separate scoped change.

Retire old API/socket/upload service routes only when supported mobile releases have migrated and legacy traffic is understood. Until then, keep .fun DNS, HTTPS renewal, routing, and sufficient CORS compatibility in place.

After browser overlap ends, .fun can potentially be removed from browser allowed origins while still serving native clients, but verify actual client behavior before tightening it. Review old provider callbacks separately.

Retain ownership and HTTPS redirects for .fun long term, preferably at least a year for public bookmarks/shared links, and longer if supported installations still depend on it. Do not revoke old mail or TURN dependencies until they are no longer needed.

## 13. Rollback

### Website/backend

1. Disable .fun page redirects; keep both hostnames proxying successfully.
2. Restore .fun as first WEB_ORIGIN and restore its explicit callback base if the callback cutover is implicated.
3. Restore previous Nginx/env settings or application image as appropriate, then validate/reload/recreate only affected services.
4. Keep .cloud API/socket/uploads functional for any mobile release already distributed with that address.
5. Keep both domains' provider registrations and certificates during investigation.
6. Restore SES_FROM only if the sender change caused delivery failures; preserve both valid identities.

Do not introduce a blanket .cloud redirect to .fun after .cloud mobile apps have shipped. Page-only fallback is possible while service routes continue operating.

### Mobile

Pause further distribution of a faulty release. Keep both API hostnames operational so old and updated apps have a functioning server. If the client itself needs repair, issue a corrected build with higher native build numbers; do not rely on users downgrading a binary or uninstalling it.

### TURN and data

Restore the prior relay hostname/certificate configuration independently if necessary, with the same active-call considerations.

Both domains use the same database and uploads. Normal rollback should preserve writes made during the migration and should not restore an older database snapshot. Restore data only for an actual data-loss incident.

## 14. Completion checklist

- [x] Desktop/backend changes implemented and reviewed.
- [x] Mobile configuration, tests, and documentation updated.
- [x] .cloud DNS and certificates verified publicly.
- [ ] Legacy .fun endpoints and renewal still work.
- [x] Canonical origins, callbacks, and generated email links use .cloud.
- [ ] Support mailbox receives messages from both mobile and backend flows.
- [ ] Existing integrations continue working; new native OAuth returns correctly.
- [ ] Signed Android/iOS builds target .cloud and pass upgrade testing.
- [ ] New mobile builds distributed through the intended channels.
- [ ] Browser permission/sign-in communication published.
- [ ] Native sessions and notification permissions preserved where applicable.
- [ ] TURN migration and cross-network media verified.
- [ ] Monitoring shows acceptable behavior across both domains.
- [ ] Permanent page redirects enabled only after validation.
- [ ] Legacy endpoint retirement decided from adoption evidence, not elapsed time alone.

## 15. Supporting documentation

- [Repository Lightsail deployment guide](docs/lightsail-deployment.md)
- [Repository deployment troubleshooting guide](DB-troubleshooting-guide.txt)
- [Mobile configuration](../websphere-mobile/app.config.ts)
- [Mobile EAS profiles](../websphere-mobile/eas.json)
- [Mobile API client](../websphere-mobile/src/lib/api.ts)
- [Mobile QA contracts](../websphere-mobile/tests/qa-contracts.test.cjs)
- [Expo app version management](https://docs.expo.dev/build-reference/app-versions/)
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)
- [Expo push token behavior](https://docs.expo.dev/push-notifications/faq/)
- [Expo deep linking](https://docs.expo.dev/linking/into-your-app/)

## 16. Verified live-server inspection — November 15, 2026

Inspection used SSH as ubuntu on 18.142.207.66 with the existing known-host entry. No server configuration was changed. Secret values and private-key contents were not printed; provider credential checks reported presence only.

### Deployment and routing

| Item | Observed state | Consequence |
| --- | --- | --- |
| Server | Ubuntu account; host ip-172-26-4-98 | Confirmed SSH target |
| Compose project | docker; seven running containers | Preserve this project and existing volumes |
| API/web | Both report healthy | Existing .fun baseline is available |
| API and worker release labels | ab9b0b43f505564cb1480cd6af0c32dec1bd6a8d | Use actual running-service metadata rather than assuming the local checkout is deployed |
| Other service release labels | Coturn and Redis reference different releases | The stack contains services from multiple deployments |
| Shared environment | /home/ubuntu/websphere/shared/.env | Confirmed production environment source |
| /home/ubuntu/websphere/current | Not found at inspected path | Resolve the actual release directory before using documentation commands that cd into current |
| Host Nginx site | /etc/nginx/sites-enabled/websphere | Active server names are websphere.fun and turn.websphere.fun |
| Host upgrade forwarding | Upgrade and Connection headers already configured | Preserve them; missing host WebSocket headers are not a confirmed live defect |
| Internal Nginx | API/uploads/socket paths match repository routing | Preserve /api stripping and root Socket.IO/uploads routes |
| Nginx syntax | nginx -t passed | Baseline configuration is valid |
| Old HTTPS health | Local host-routed https://websphere.fun/api/health returned 200 with valid TLS | Confirmed existing server endpoint |
| Exposed database/cache ports | MySQL 3306 and Redis 6379 bind to loopback | Preserve existing bindings |
| Host UFW | Inactive | AWS Lightsail firewall remains a separate, unverified control |

### DNS and HTTPS

These are results from the server's resolver at inspection time, not an authoritative-zone inventory:

| Name | Observed addresses/state |
| --- | --- |
| websphere.fun | 18.142.207.66 |
| www.websphere.fun | Unresolved |
| turn.websphere.fun | 18.142.207.66 |
| websphere.cloud | 2.57.91.91 and 2a02:4780:84::32 |
| www.websphere.cloud | 2.57.91.91 and 2a02:4780:84::32 |
| turn.websphere.cloud | Unresolved |

**DNS cutover must address both IPv4 and IPv6.** Update .cloud to the Lightsail IP and remove or replace the existing AAAA destination unless working IPv6 service is deliberately configured. Changing only A would leave some clients reaching the previous destination over IPv6.

Certbot lists one certificate, named websphere.fun, covering websphere.fun and turn.websphere.fun, expiring January 27, 2027 at 01:16:35 UTC. It does not cover either www name or .cloud.

A local host-routed .cloud HTTPS request failed certificate hostname verification. No .cloud virtual host or matching certificate was present in the inspected Nginx configuration. Prepare both before making .cloud the application address.

### Effective application settings

| Setting | Current observed value/state |
| --- | --- |
| NODE_ENV | production |
| WEB_ORIGIN | https://websphere.fun |
| OAUTH_CALLBACK_BASE_URL | Not present in inspected API environment |
| SUPPORT_EMAIL | Not present in inspected API environment |
| SES_FROM | hello@websphere.fun |
| SES_HOST | email-smtp.ap-southeast-1.amazonaws.com |
| SES_PORT | 587 |
| VAPID_SUBJECT | mailto:hello@websphere.fun |
| TURN_HOST | turn.websphere.fun |
| TURN_CERT_NAME | websphere.fun |
| TURN_CERT_DIR | /etc/letsencrypt/live/websphere.fun/fullchain.pem |
| TURN_EXTERNAL_IP | 18.142.207.66 |
| COMPOSE_PROFILES | turn |

Google, Microsoft, Trello, Asana, and Canva client credentials were present. Google Picker configuration and VAPID keys were present. Notion client credentials were absent. Presence does not verify provider registrations, token validity, mail delivery, or API access.

Retain hello@websphere.fun as sender until the intended .cloud sender identity is verified in SES ap-southeast-1. Decide whether the new sender remains hello@websphere.cloud; do not assume noreply is the current address.

### Confirmed TURN certificate problem

The current coturn bind mount maps the host file:

    /etc/letsencrypt/live/websphere.fun/fullchain.pem

onto the container path:

    /etc/letsencrypt

Inside the container, /etc/letsencrypt is consequently a regular file. The configured certificate and private-key paths beneath /etc/letsencrypt/live/websphere.fun are both unreadable. A local TLS handshake to port 5349 returned no certificate, and recent coturn logs contained certificate/private-key listener error categories.

This confirms a TLS relay readiness problem; it does not establish whether plain TURN over 3478 currently works.

Before the relay domain cutover, correct the production setting to mount the directory tree:

    TURN_CERT_DIR=/etc/letsencrypt
    TURN_CERT_NAME=websphere.fun

Recreate coturn in a coordinated low-usage window, then verify the existing turn.websphere.fun TLS listener first. Only after that baseline passes should the new relay certificate/name be introduced. Keep certificate coverage for any hostname still used by clients.

Certbot's timer is present and the renewal uses the Nginx authenticator/installer. No files were found in the standard renewal-hooks directory, and no coturn reload reference was found in the inspected standard cron/systemd locations. Add and verify a renewal deploy hook that targets the actual release/project location; an alternate custom hook elsewhere has not been ruled out.

### Redis persistence correction

The running Redis container has an anonymous Docker volume mounted at /data. It uses RDB snapshots with save rules 3600/1, 300/100, and 60/10000; AOF is disabled. Its last reported background save succeeded.

This is more specific than the repository-only assessment: data is stored in a volume, but its lifecycle is not documented as an explicitly named Compose volume. Preserve the current volume and Redis process. Record the volume identity securely and capture a suitable backup before any infrastructure replacement. Recent authentication state may not yet be included in an RDB snapshot.

### Remaining checks and next execution gates

1. Verify authoritative DNS records, CAA, mail records, and DNS ownership; prepare A/AAAA/turn changes.
2. Prepare .cloud Nginx/TLS and the precise compatibility-location rules without enabling blanket API redirects.
3. Confirm provider callback registrations, Google Picker restrictions, SES identity, and support inbox in their live accounts.
4. Resolve the existing TURN TLS mount issue in a separate authorized maintenance action.
5. Inspect stored application-owned URLs and actual distributed mobile build configuration.
6. Run the signed old/new-client, OAuth, push, mail, and cross-network call verification matrix.

Server inspection has reduced the infrastructure unknowns. It does not constitute completed migration testing or full production coverage.


## 17. Execution status — November 15, 2026

The user authorized implementation through Hostinger, Lightsail, SSH, and the mobile project. Incoming .cloud mailbox setup and the remaining iOS release were explicitly deferred by the user. The final scope completed in this session is the website/backend migration plus the signed Android release.

### Completed and verified

- Exported the original Hostinger zone to Downloads/websphere.cloud.txt.
- Created private server backups of the production environment, host Nginx configuration, certificate renewal configuration, MySQL dump, and uploaded files at /home/ubuntu/websphere/shared/domain-migration-20261114T173830Z. The timestamp is UTC; this was November 15 in Manila.
- Pointed websphere.cloud and turn.websphere.cloud to 18.142.207.66 with TTL 300; retained www CNAME and removed the previous unrelated AAAA destination.
- Confirmed Lightsail static IP and required existing IPv4 firewall rules. No new inbound exposure was added.
- Installed .cloud HTTP/HTTPS host Nginx configuration. Issued websphere.cloud certificate covering apex, www, and the new TURN hostname, expiring February 12, 2027.
- Set WEB_ORIGIN to https://websphere.cloud,https://websphere.fun. Initially retained the old callback as a compatibility bridge, then switched OAUTH_CALLBACK_BASE_URL to https://websphere.cloud/api after all five enabled providers accepted the new callback. Legacy callback routes and in-flight Redis state remain available.
- Deployed the tested configurable SUPPORT_EMAIL change through an image layer containing only config.service.js and email.service.js over the existing production API image. Kept SUPPORT_EMAIL=support@websphere.fun pending receiving setup. Rollback image tag: docker-api:domain-migration-base. Build context: /home/ubuntu/websphere/releases/domain-migration-20261115.
- Preserved Redis, database, upload volumes, application secrets, and integration identities. Reloaded/restarted the web proxy as needed to clear its cached upstream address after API recreation; both API hostnames subsequently returned 200.
- Corrected coturn's certificate mount and non-root read access. Issued a separate websphere-turn certificate covering both turn.websphere.fun and turn.websphere.cloud. Exported only its certificate/key to /home/ubuntu/websphere/shared/turn-certs, mounted read-only; key is owned by UID/GID 65534 with mode 600.
- Set TURN_HOST=turn.websphere.cloud, TURN_CERT_NAME=websphere-turn, and TURN_CERT_DIR=/home/ubuntu/websphere/shared/turn-certs.
- Installed /etc/letsencrypt/renewal-hooks/deploy/websphere-services.sh, persisted in docker/renew-websphere-certificates.sh. Corrected the repository reload signal from HUP to USR2, matching coturn 4.6.2 certificate-reload handling.
- Verified TLS certificates for both relay names, and performed successful authenticated relay allocation and cleanup from the local computer over UDP 3478, TCP 3478, and TLS 5349.
- Passed Certbot renewal simulations for both websphere.cloud and websphere-turn, and exercised the deploy hook.
- Verified health, CORS preflights, and Socket.IO handshakes on both application hostnames. External HTTPS website/health checks passed.
- Enabled temporary 302 redirects from ordinary .fun pages to .cloud, preserving paths and queries. /api/, /uploads/, /socket.io/, /assets/, and /sw.js remain served directly for legacy clients. Verified an old integration page redirects and the old health endpoint still returns 200.
- Added .cloud origin/callback to the matched Google production OAuth client; retained .fun. Added https://websphere.cloud/* to the existing Picker key restrictions without changing API scope. Updated Google branding website/privacy/terms hosts; retained existing receiving contacts.
- Added .cloud Microsoft callback to the matched existing application while retaining .fun.
- Added and saved the .cloud Asana callback on the matched existing application while retaining .fun.
- Added the .cloud Canva callback to the matched existing integration while retaining .fun.
- Added and saved the .cloud Trello callback on the matched existing confidential client while retaining .fun and its original scopes.
- Created the websphere.cloud SES identity in ap-southeast-1 with 2048-bit Easy DKIM. Published its three CNAME records and a valid DMARC monitoring policy. SES reports the identity Verified and DKIM Successful. Outgoing sender configuration is hello@websphere.cloud for API and worker; receiving remains deferred. SMTP connection and authentication verification passed without sending a message. Actual message receipt still requires an end-to-end user flow.

### Mobile release

- Updated app.config.ts and src/lib/api.ts defaults, four production-connected EAS profiles, README, and the ignored local production API URL to https://websphere.cloud/api. Intentional LAN configuration remains available.
- Prepared version 1.0.1, Android versionCode 2, and iOS buildNumber 8 after checking prior EAS releases.
- Preserved com.websphere.mobile, websphere scheme, EAS project, and existing signing credentials. Existing Firebase client configuration resolves for the same Android package.
- Added production-play as an explicit AAB profile and corrected build:aab to select it; production continues producing the existing APK distribution format.
- Mobile type checking and lint passed. All 25 QA tests passed, including URL precedence, relative uploads, socket origin, and legacy absolute-upload compatibility.
- Android production build 7ced0b50-7907-4f67-a277-3a22afd3ecd5 finished successfully. Downloaded through the authenticated EAS CLI to /Users/vinceaustria/Downloads/websphere-mobile-1.0.1-android.apk (157,031,161 bytes). ZIP integrity passed; its compiled bundle contains https://websphere.cloud/api and does not contain https://websphere.fun/api. SHA-256: b5384fc9be1775d73e078c12b2ade40fddd007d931dd78ecb026bfdc38ada44a.
- iOS build is blocked during provisioning of the existing screen-sharing extension target com.websphere.mobile.broadcast. Apple returns HTTP 403 requiring an in-effect Developer Program agreement. The user reported accepting it and confirmed the exact team; subsequent API retries, including several hours later, still failed with the same Apple agreement error. EAS credentials identify team HZ4LZ8A798 (Vince Bernard Austria, Individual). The existing main-app profile is active; the broadcast extension has no credentials yet. Do not remove that feature or replace signing identity to bypass this blocker.

### Validation and remaining work

The API's 236-test run and build passed; the three additional email-domain tests also passed, including canonical reset links, the explicit callback bridge, and configurable support routing. A focused seven-test email/OAuth run passed.

Production URL audit found zero old absolute avatar URLs, one user-linked resource URL, and two settings with .fun references. One setting is historical Canva OAuth client metadata; the other is releaseManifestUrl=https://websphere.fun/, which already points to a page rather than a valid JSON release manifest. Those values were not blindly rewritten. A correct release-manifest endpoint is a separate follow-up.

Outstanding gates:

- Perform real-device upgrade and push/call smoke testing with the completed Android APK.
- Deferred by user: resolve Apple's agreement/API access response for the recorded team, provision the broadcast target through the existing credentials workflow, and build iOS 1.0.1.
- Exercise real account authorization/refresh flows on the new callbacks. All five registrations and the canonical .cloud callback base are configured; legacy callback routes remain available. The deployed API was checked directly to generate .cloud callback URLs for all five providers, and both old/new Google callback routes returned the expected 400 for a synthetic invalid state without a cross-domain redirect.
- Verify actual transactional email delivery with a user-initiated flow. SES domain verification passed; incoming .cloud receiving setup is deferred by user request and support requests retain their existing .fun recipient.
- End-to-end authenticated user flows, actual push receipt, and real audio/video sessions still need account/device testing; relay allocation tests do not replace those checks.
- Keep page redirects temporary during observation. Retain legacy service endpoints until supported installed mobile versions have migrated.

No public App Store or Play release has been submitted by this migration session. The signed Android APK is available for installation from Downloads. No signed iOS 1.0.1 artifact has been produced because Apple still rejects provisioning. A browser sign-in handoff was requested to inspect the Apple account restriction directly; the user chose to leave iOS pending. Resume this work only when requested, preserving the existing team and app identity.

After the interruption, the live server was rechecked: both domain APIs remained healthy, the canonical callback was then successfully switched to .cloud, and the completed Android artifact was downloaded and inspected. The user confirmed agreement acceptance for the exact Apple team; the same Apple API error persisted on the resumed attempt.


### Final handoff

- Website: https://websphere.cloud
- Android APK: [websphere-mobile-1.0.1-android.apk](/Users/vinceaustria/Downloads/websphere-mobile-1.0.1-android.apk)
- EAS Android build: https://expo.dev/accounts/elsa-versailles/projects/websphere-mobile/builds/7ced0b50-7907-4f67-a277-3a22afd3ecd5
- Outgoing sender: hello@websphere.cloud; SMTP authentication passed and SES identity/DKIM are verified. No test message was sent.
- Existing support recipient remains support@websphere.fun until .cloud receiving is configured.
- iOS remains version-configured for 1.0.1/build 8 but unsigned; completion is deferred by the user.
- Later browser QA in section 18 covers authenticated member/admin flows, one real Asana authorization, and local media/call controls. Real-device Android upgrade, push receipt, full provider-resource sync/refresh, and media between participants remain unverified. Earlier checks cover repository tests/builds, public routing/TLS/CORS/socket handshakes, authenticated relay allocations, and the APK's compiled API URL.

## 18. Live website functional QA — November 15, 2026

Browser QA exercised member and administrator navigation, notification deep links, private self-only group chat and search, idea revision/voting, project/task workflows, calendar events, the AI assistant, database backup creation/download, and local audio/video call controls. Browser WebSocket upgrades to the new origin succeeded. Supplementary web tests passed all 61 cases; the focused API email/OAuth suite passed seven cases.

Asana authorization and disconnection completed through an existing provider session. Google, Microsoft and Trello initiation reached their provider screens using the new callback host; full authorization, provider resource sync and token refresh remain unverified. Physical-device upgrades, media between participants, browser push and actual verification/reset email delivery remain release gates. Destructive production actions were not exercised.

Detailed operational findings and test-account records are retained privately by the operator rather than published in this repository. This is representative functional coverage, not a claim of exhaustive validation. The requested Software Update UI removal is recorded in section 19.

## 19. Software Update UI removed — November 15, 2026

At the user's request, removed the Software Update row, Check now action, release-manifest URL input, release-notes dialog and their unused client state/request handler from System Settings. Renamed Maintenance & Updates to Maintenance and arranged Backup Database and Maintenance Mode in two columns. The existing general-settings API contract and stored configuration are preserved.

- Source: `apps/web/src/ui/LegacyPages.tsx`; unrelated working-tree edits were excluded from the build.
- Built from deployed revision `ab9b0b43f505564cb1480cd6af0c32dec1bd6a8d` plus only this source change, in an isolated temporary checkout.
- Targeted ESLint, production Vite build and source diff checks passed. Verified the new bundle omits the removed UI and retains backup, maintenance and system-log controls.
- Deployed only the web container. API, worker, MCP, MySQL, Redis and Coturn container IDs remained unchanged. Web readiness and public API health passed.
- New public JavaScript asset: `index-DUfmueHN.js`. Existing hashed assets were retained for already-open clients.
- After a hard reload in Chrome, the live administrator settings page no longer shows Software Update, Check now or Release Manifest URL. Backup, maintenance, security and log controls still render.
- Server patch/build context: `/home/ubuntu/websphere/releases/remove-software-update-20261115`.
- Previous web image retained as `docker-web:before-remove-software-update-20261115`; deployed tag `docker-web:remove-software-update-20261115` and `docker-web:latest`.
- Include this change alongside the migration updates in the next normal repository release so a later CI deployment retains the removal.
