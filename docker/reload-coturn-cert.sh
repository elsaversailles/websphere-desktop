#!/bin/sh
set -eu

# Install this as the certificate renewal deploy hook.  HUP makes coturn reload
# its TLS certificate without interrupting the rest of the WebSphere stack.
docker compose -f "${COMPOSE_FILE:-docker/docker-compose.yml}" kill -s HUP coturn
