#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backend_env="$repository_root/silto-gfsi-be/.env"
key_file="$repository_root/silto-gfsi-be/.secrets/label-dev-local.json"

if [[ ! -f "$backend_env" || ! -f "$key_file" ]]; then
  echo "Missing local SILTO backend environment or LABEL GCS development key." >&2
  exit 1
fi

read_backend_value() {
  local name="$1"
  local value
  value="$(awk -v name="$name" '
    index($0, name "=") == 1 {
      value = substr($0, length(name) + 2)
      if (value ~ /^".*"$/) value = substr(value, 2, length(value) - 2)
      print value
      exit
    }
  ' "$backend_env")"
  if [[ -z "$value" ]]; then
    echo "$name must be set in silto-gfsi-be/.env" >&2
    exit 1
  fi
  printf '%s' "$value"
}

export DATABASE_URL="$(read_backend_value DATABASE_URL)"
export LABEL_GCS_BUCKET="$(read_backend_value LABEL_GCS_BUCKET)"
export OPENROUTER_API_KEY="$(read_backend_value OPENROUTER_API_KEY)"
export LABEL_GOVERNANCE_LOCAL_TOKEN="$(read_backend_value LABEL_GOVERNANCE_LOCAL_TOKEN)"

export NODE_ENV=development
export PORT=8081
export HOST=127.0.0.1
export VERA_DATABASE_URL="$DATABASE_URL"
export DATABASE_URL="$VERA_DATABASE_URL"
export VERA_DATABASE_SCHEMA=vera
export GOVERNANCE_DATABASE_SCHEMA=vera
export GOVERNANCE_LOCAL_MODE=true
export GOVERNANCE_LOCAL_AUTH_TOKEN="$LABEL_GOVERNANCE_LOCAL_TOKEN"
export GOVERNANCE_AUDIENCE=http://127.0.0.1:8081
export GOVERNANCE_BACKEND_SERVICE_ACCOUNT_EMAIL=local-governance@localhost
export GOVERNANCE_BACKEND_URL=http://127.0.0.1:8084
export GOVERNANCE_BACKEND_AUDIENCE=http://127.0.0.1:8084
export GOVERNANCE_GCS_BUCKET="$LABEL_GCS_BUCKET"
export CHROMA_ENDPOINT=http://127.0.0.1:8000
export GOOGLE_APPLICATION_CREDENTIALS="$key_file"

cd "$repository_root/vera"
pnpm --filter @vera/storage migrate:deploy
pnpm --filter @vera/label-governance build
exec node apps/label-governance/dist/main.js
