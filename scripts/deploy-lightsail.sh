#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_ROOT="${1:-$HOME/websphere}"
RELEASE_ID="${2:?release SHA is required}"
ARCHIVE_PATH="${3:?uploaded release archive path is required}"
PROJECT_NAME="${4:-docker}"
SERVICES=(mysql redis api worker mcp web)

log() { printf '[deploy] %s\n' "$*"; }
fail() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$RELEASE_ID" =~ ^[a-f0-9]{40}$ ]] || fail 'release ID must be a full Git commit SHA'
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'Compose project name contains unsupported characters'
[[ "$ARCHIVE_PATH" == "/tmp/websphere-${RELEASE_ID}.tar.gz" ]] || fail 'archive path is outside the expected deployment target'
[[ -f "$ARCHIVE_PATH" ]] || fail "release archive does not exist: $ARCHIVE_PATH"
if [[ "$DEPLOY_ROOT" != /* ]]; then DEPLOY_ROOT="$HOME/$DEPLOY_ROOT"; fi
[[ "$DEPLOY_ROOT" != / && "$DEPLOY_ROOT" != "$HOME" ]] || fail 'deployment root is too broad'

mkdir -p "$DEPLOY_ROOT/releases" "$DEPLOY_ROOT/shared"
exec 9>"$DEPLOY_ROOT/deploy.lock"
command -v flock >/dev/null 2>&1 || fail 'flock is required on the Lightsail instance'
flock -n 9 || fail 'another deployment is already running'

cleanup() { rm -f -- "$ARCHIVE_PATH"; }
trap cleanup EXIT

ENV_FILE="$DEPLOY_ROOT/shared/.env"
[[ -f "$ENV_FILE" ]] || fail "create the production environment file first: $ENV_FILE"
chmod 600 "$ENV_FILE"

RELEASE_DIR="$DEPLOY_ROOT/releases/$RELEASE_ID"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
ln -sfn "$ENV_FILE" "$RELEASE_DIR/.env"

COMPOSE_FILE="$RELEASE_DIR/docker/docker-compose.yml"
[[ -f "$COMPOSE_FILE" ]] || fail 'release does not contain docker/docker-compose.yml'

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
else
  fail 'Docker is unavailable; add the deploy user to the docker group or allow passwordless sudo for Docker'
fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required'

export COMPOSE_PARALLEL_LIMIT=1
export BUILDKIT_PROGRESS=plain

compose() {
  "${DOCKER[@]}" compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$COMPOSE_FILE" "$@"
}

docker_cmd() { "${DOCKER[@]}" "$@"; }

service_logs() {
  local service="$1"
  compose logs --no-color --tail 120 "$service" >&2 || true
}

wait_for_service() {
  local service="$1"
  local timeout_seconds="${2:-180}"
  local deadline=$((SECONDS + timeout_seconds))
  local stable_checks=0
  while (( SECONDS < deadline )); do
    local container_id status health
    container_id="$(compose ps -q "$service")"
    if [[ -n "$container_id" ]]; then
      status="$(docker_cmd inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
      health="$(docker_cmd inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || true)"
      if [[ "$status" == running && "$health" == healthy ]]; then
        log "$service is healthy"
        return 0
      fi
      if [[ "$status" == running && "$health" == none ]]; then
        stable_checks=$((stable_checks + 1))
        if (( stable_checks >= 5 )); then
          log "$service remained running through five checks"
          return 0
        fi
      else
        stable_checks=0
      fi
      if [[ "$status" == exited || "$status" == dead || "$health" == unhealthy ]]; then break; fi
    fi
    sleep 3
  done
  log "$service failed its readiness check"
  service_logs "$service"
  return 1
}

backup_service_image() {
  local service="$1" container_id image_id
  container_id="$(compose ps -q "$service")"
  [[ -n "$container_id" ]] || return 0
  image_id="$(docker_cmd inspect --format '{{.Image}}' "$container_id")"
  docker_cmd tag "$image_id" "$PROJECT_NAME-$service:rollback"
  log "saved the current $service image as $PROJECT_NAME-$service:rollback"
}

rollback_service() {
  local service="$1"
  local backup="$PROJECT_NAME-$service:rollback"
  local target="$PROJECT_NAME-$service:latest"
  if ! docker_cmd image inspect "$backup" >/dev/null 2>&1; then
    log "no previous $service image is available for rollback"
    return 1
  fi
  log "rolling $service back to its previous image"
  docker_cmd tag "$backup" "$target"
  compose up -d --no-deps --force-recreate "$service"
  wait_for_service "$service" 180
}

validate_runtime_config() {
  log 'validating production database, Redis, origin, and secret configuration'
  compose run --rm --no-deps api node --input-type=module --eval '
    const fail = (message) => { console.error(`[config] ${message}`); process.exit(1); };
    const required = (name) => process.env[name] || fail(`${name} is required`);
    const { ConfigService } = await import("./apps/api/dist/config.service.js");
    new ConfigService();
    if (required("NODE_ENV") !== "production") fail("NODE_ENV must be production");
    const database = new URL(required("DATABASE_URL"));
    if (database.protocol !== "mysql:" || database.hostname !== "mysql") fail("DATABASE_URL_DOCKER must use mysql:3306 inside Docker");
    if (database.port && database.port !== "3306") fail("DATABASE_URL_DOCKER must use MySQL port 3306");
    const databaseUser = decodeURIComponent(database.username);
    const databasePassword = decodeURIComponent(database.password);
    const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ""));
    const mysqlUser = process.env.MYSQL_USER || "websphere";
    const mysqlPassword = process.env.MYSQL_PASSWORD || "websphere";
    const mysqlDatabase = process.env.MYSQL_DATABASE || "websphere";
    const mysqlRootPassword = process.env.MYSQL_ROOT_PASSWORD || "rootpassword";
    if (!databaseUser || !databasePassword) fail("DATABASE_URL_DOCKER must contain database credentials");
    if (databaseUser !== mysqlUser || databasePassword !== mysqlPassword || databaseName !== mysqlDatabase) fail("DATABASE_URL_DOCKER credentials and database must match the effective MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE values");
    if (databasePassword === "websphere") console.warn("[config] WARNING: deploying with the insecure default MySQL application password");
    if (mysqlRootPassword === "rootpassword") console.warn("[config] WARNING: deploying with the insecure default MySQL root password");
    const redis = new URL(required("REDIS_URL"));
    if (redis.protocol !== "redis:" || redis.hostname !== "redis") fail("REDIS_URL_DOCKER must use redis:6379 inside Docker");
    if (redis.port && redis.port !== "6379") fail("REDIS_URL_DOCKER must use Redis port 6379");
    for (const origin of required("WEB_ORIGIN").split(",")) {
      const host = new URL(origin.trim()).hostname;
      if (host === "localhost" || host === "127.0.0.1") fail("WEB_ORIGIN must use the production website");
    }
    const access = required("JWT_ACCESS_SECRET");
    const refresh = required("JWT_REFRESH_SECRET");
    if (access.length < 32 || refresh.length < 32 || access.includes("replace-with") || refresh.includes("replace-with")) fail("replace the JWT secrets with fresh values of at least 32 characters");
    if (access === refresh) fail("JWT access and refresh secrets must be different");
  '
}

run_prisma() {
  compose run --rm --no-deps api sh -ec '
    if pnpm exec prisma --version >/dev/null 2>&1; then
      exec pnpm exec prisma "$@"
    fi
    prisma_cli="$(find /app/node_modules/.pnpm -path "*/node_modules/prisma/build/index.js" -print -quit)"
    if [ -z "$prisma_cli" ]; then
      echo "Prisma CLI was not found in the API image" >&2
      exit 127
    fi
    exec node "$prisma_cli" "$@"
  ' prisma "$@"
}

verify_database_schema() {
  local tables
  log 'verifying application tables and Prisma migration history'
  if ! tables="$(compose exec -T mysql sh -ec 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --host=127.0.0.1 --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --batch --skip-column-names --execute="SHOW TABLES"')"; then
    log 'MySQL rejected MYSQL_USER/MYSQL_PASSWORD; initialization variables do not update credentials in an existing volume'
    return 1
  fi
  tables="${tables//$'\r'/}"
  grep -Fxq 'User' <<<"$tables" || { log 'required User table is missing after migration'; return 1; }
  grep -Fxq '_prisma_migrations' <<<"$tables" || { log 'Prisma migration history table is missing after migration'; return 1; }
  log 'database schema contains User and _prisma_migrations'
}

start_infrastructure_service() {
  local service="$1"
  log "pulling $service"
  compose pull "$service"
  log "starting $service"
  compose up -d --no-deps "$service"
  wait_for_service "$service" 240
}

deploy_built_service() {
  local service="$1"
  backup_service_image "$service"
  log "building $service by itself"
  if ! compose build --pull "$service"; then
    log "$service image build failed; the existing container was left running"
    return 1
  fi

  if [[ "$service" == api ]]; then
    if ! validate_runtime_config; then
      log 'production configuration validation failed; no API container was replaced'
      return 1
    fi
    log 'applying Prisma migrations before replacing the API container'
    if ! run_prisma migrate deploy --schema=prisma/schema.prisma; then
      log 'database migration failed; the existing API container was left running'
      log 'if this volume already existed, changing MYSQL_PASSWORD in .env did not change the MySQL account password'
      return 1
    fi
    if ! verify_database_schema; then
      log 'database schema verification failed; the existing API container was left running'
      return 1
    fi
  fi

  log "starting the new $service container"
  if ! compose up -d --no-deps --force-recreate "$service"; then
    rollback_service "$service" || true
    return 1
  fi
  if ! wait_for_service "$service" 240; then
    rollback_service "$service" || true
    return 1
  fi
}

log "deploying release $RELEASE_ID from $RELEASE_DIR"
compose config --quiet
start_infrastructure_service mysql
start_infrastructure_service redis
deploy_built_service api
deploy_built_service worker
deploy_built_service mcp
deploy_built_service web

for service in "${SERVICES[@]}"; do
  container_id="$(compose ps -q "$service")"
  [[ -n "$container_id" ]] || fail "$service has no container after deployment"
  [[ "$(docker_cmd inspect --format '{{.State.Status}}' "$container_id")" == running ]] || fail "$service is not running after deployment"
done

ln -sfnT "$RELEASE_DIR" "$DEPLOY_ROOT/active-release" 2>/dev/null || true
compose ps
log "release $RELEASE_ID deployed successfully; every service is running"
