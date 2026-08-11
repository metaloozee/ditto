#!/usr/bin/env bash
# Local-only Docker shim for Alchemy container dev.
# cloudflare-runtime always `docker pull`s imageUri containers; local tags
# are not on a registry. If the image is already present, skip pull.
set -euo pipefail
if [[ "${1:-}" == "pull" ]]; then
  image="${2:-}"
  if [[ -n "$image" ]] && command docker image inspect "$image" >/dev/null 2>&1; then
    exit 0
  fi
fi
exec docker "$@"
