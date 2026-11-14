#!/bin/sh
set -eu

# Install on the current Lightsail host as a Certbot deploy hook, run as root.
# coturn runs as nobody; export only its own certificate and key, read-only.
nginx -t
systemctl reload nginx
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/websphere-turn ]; then
    install -o 65534 -g 65534 -m 644 "$RENEWED_LINEAGE/fullchain.pem" /home/ubuntu/websphere/shared/turn-certs/live/websphere-turn/fullchain.pem
    install -o 65534 -g 65534 -m 600 "$RENEWED_LINEAGE/privkey.pem" /home/ubuntu/websphere/shared/turn-certs/live/websphere-turn/privkey.pem
    docker kill --signal=USR2 docker-coturn-1 >/dev/null
fi
