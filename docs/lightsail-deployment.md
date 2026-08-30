# Lightsail deployment

The `Deploy to Lightsail` workflow uploads the exact Git commit to the server over SSH. The server builds and replaces one service at a time in this order:

`mysql → redis → api migration/API → worker → MCP → web`

The existing application containers continue running while their replacement image builds. Each replacement must pass its readiness check before the next image is built. If API, worker, MCP, or web fails after replacement, the script attempts to restore that service's previous image.

## One-time server setup

Install Docker Engine with the Docker Compose v2 plugin. The deployment user must either belong to the `docker` group or have passwordless `sudo docker` access. It also needs `tar` and `flock` (normally provided by `util-linux`).

Create the shared production environment file. The default deployment directory is `~/websphere`; a custom GitHub variable can change it.

```bash
mkdir -p "$HOME/websphere/shared"
install -m 600 /dev/null "$HOME/websphere/shared/.env"
nano "$HOME/websphere/shared/.env"
```

Start from `example.env`, then set production values. In particular:

```dotenv
NODE_ENV=production
WEB_ORIGIN=https://your-domain.example
DATABASE_URL_DOCKER=mysql://websphere:strong-url-encoded-password@mysql:3306/websphere
REDIS_URL_DOCKER=redis://redis:6379
MYSQL_DATABASE=websphere
MYSQL_USER=websphere
MYSQL_PASSWORD=strong-database-password
MYSQL_ROOT_PASSWORD=strong-root-password
DOCKER_BUILD_NODE_OPTIONS=--max-old-space-size=512
```

`DATABASE_URL_DOCKER` and `MYSQL_PASSWORD` must represent the same password. Keep the raw password in `MYSQL_PASSWORD`; percent-encode reserved URL characters only in `DATABASE_URL_DOCKER`.

Also provide fresh JWT secrets, the 32-byte Base64 encryption key, SES credentials, and any enabled provider credentials. Do not commit this file.

## GitHub production environment

Create a GitHub Environment named `production` and add these secrets:

- `LIGHTSAIL_HOST`: instance public IP address or DNS name.
- `LIGHTSAIL_USER`: SSH user, commonly `ubuntu`.
- `LIGHTSAIL_SSH_PRIVATE_KEY`: the complete private key, including header and footer.
- `LIGHTSAIL_SSH_KNOWN_HOSTS`: the verified host-key line. Generate it from a trusted machine with `ssh-keyscan -H <host>` and verify its fingerprint against the Lightsail console before saving it.

Optional environment variables:

- `LIGHTSAIL_SSH_PORT`: defaults to `22`.
- `LIGHTSAIL_DEPLOY_PATH`: defaults to `~/websphere`; use an absolute path only when the deployment user owns it.
- `LIGHTSAIL_COMPOSE_PROJECT`: defaults to `docker`, matching this repository's existing Compose volume/container names. Set it to the current stack's project name if the server was originally launched with `docker compose -p <name>`.

The Lightsail firewall should expose only the public host-Nginx ports (normally 80 and 443) plus the restricted SSH port. MySQL (`3306`), Redis (`6379`), and the Docker web port (`8080`) are bound to server loopback and must not be exposed by the Lightsail firewall.

## CGNAT-safe voice and video calls

WebRTC needs a TURN relay for users behind CGNAT or restrictive firewalls. WebSphere ships a self-hosted coturn profile; it is not proxied through Nginx. Add these production values to the shared `.env` file (do not commit it):

```dotenv
COMPOSE_PROFILES=turn
TURN_HOST=turn.your-domain.example
TURN_REALM=websphere
TURN_SHARED_SECRET=generate-a-random-secret-of-at-least-32-characters
TURN_EXTERNAL_IP=your-lightsail-static-public-ip
TURN_CERT_DIR=/etc/letsencrypt
TURN_CERT_NAME=turn.your-domain.example
TURN_RELAY_MIN_PORT=49160
TURN_RELAY_MAX_PORT=49200
TURN_CREDENTIAL_TTL_SECONDS=3600
```

Point `turn.your-domain.example` to the instance's static public IP. `TURN_CERT_NAME` is the Let’s Encrypt certificate directory name under `TURN_CERT_DIR/live/`; coturn mounts the entire Let’s Encrypt tree read-only so its `live/` symlinks can resolve into `archive/`. Open the following **inbound** Lightsail and host-firewall rules in addition to the web ports:

- TCP and UDP `3478` for STUN/TURN.
- TCP and UDP `5349` for TLS TURN.
- UDP `49160-49200` for relayed media.

After every certificate renewal, reload coturn so the TLS listener uses the new files:

```bash
cd ~/websphere/current
COMPOSE_FILE=docker/docker-compose.yml sh docker/reload-coturn-cert.sh
```

For Certbot, register that command as a deploy hook. The API creates a unique one-hour TURN REST credential only after authenticating the caller and verifying group membership; neither the TURN shared secret nor a reusable TURN password is sent to the browser.

Run host Nginx on ports 80/443 and proxy the site to `http://127.0.0.1:8080`. The web-container Nginx keeps `proxy_pass http://api:3000/` with its trailing slash so `/api/auth/login` reaches the backend as `/auth/login`.

## Deployment behavior

- GitHub concurrency prevents two production deployments from overlapping.
- A server-side `flock` lock provides a second overlap guard.
- `COMPOSE_PARALLEL_LIMIT=1` disables parallel Compose operations.
- Node heap is capped during image builds through `DOCKER_BUILD_NODE_OPTIONS` (512 MB by default).
- MySQL and Redis are pulled and checked separately.
- Prisma migrations run after the API image builds and before the API container is replaced.
- Migration execution first uses `pnpm exec prisma`, then automatically locates and invokes the image's local Prisma CLI if the pnpm executable is unavailable.
- Deployment verifies that both `User` and `_prisma_migrations` exist before starting the API. A missing schema stops the deployment while leaving the old API container running.
- Production preflight rejects `localhost` container URLs, localhost web origins, mismatched database settings, and placeholder/reused JWT secrets. Default MySQL passwords currently produce explicit warnings instead of blocking deployment and must be rotated as soon as possible.
- API and web health checks exercise `/health`; worker and MCP must remain running for five consecutive checks.
- Release source is retained under `releases/<commit-sha>` for diagnosis. Old release directories are not deleted automatically.

Database migrations are not automatically rolled back. Keep production migrations backward-compatible with the currently running API during a rolling deployment.

On a small Lightsail plan, configure swap before the first deployment and confirm it with `free -h`. The workflow deliberately does not create or resize swap because that is a host-level administrative decision.

MySQL initialization variables only affect a new, empty database volume. Changing `MYSQL_PASSWORD` after the volume already exists does not change the database user's password; rotate an existing database password inside MySQL and update `DATABASE_URL_DOCKER` in the same maintenance window.

After the first deployment, verify the applied schema without putting a password on the command line:

```bash
sudo docker exec docker-mysql-1 sh -ec \
  'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "SHOW TABLES; SELECT migration_name, finished_at FROM _prisma_migrations;"'
```

You should see `User`, `_prisma_migrations`, and the `20260827000000_initial` migration with a completed timestamp. Unexpected API failures are permanently written to `docker logs docker-api-1`; the public response remains a safe generic 500.
