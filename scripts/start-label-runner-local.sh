#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backend_root="$repository_root/silto-gfsi-be"
backend_env="$backend_root/.env"
key_file="$backend_root/.secrets/label-dev-local.json"

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

if [[ ! -f "$backend_root/dist/application/label/preliminary-template.js" ]]; then
  echo "Build silto-gfsi-be first (npm run build)." >&2
  exit 1
fi

export NODE_ENV=development
export PORT=8080
export LABEL_RUNNER_MODE=evaluation
export LABEL_RUNNER_LOCAL_MODE=true
export LABEL_RUNNER_LOCAL_TOKEN="$(read_backend_value LABEL_RUNNER_LOCAL_TOKEN)"
export LABEL_BACKEND_URL=http://127.0.0.1:8084
export LABEL_BACKEND_AUDIENCE=http://127.0.0.1:8084
export LABEL_GCS_BUCKET="$(read_backend_value LABEL_GCS_BUCKET)"
export GCP_PROJECT_ID="$(read_backend_value GCP_PROJECT_ID)"
export OPENROUTER_API_KEY="$(read_backend_value OPENROUTER_API_KEY)"
export LABEL_OPENROUTER_MODEL=google/gemini-2.5-flash
# In local loopback mode the immutable template in runner-input selects the
# prompt/rule-pack. Production continues to pin these deployment variables.
unset LABEL_PROMPT_VERSION LABEL_RULE_PACK_VERSION
export LABEL_SOURCE_SNAPSHOT="$(node -e "process.stdout.write(require('$backend_root/dist/application/label/preliminary-template.js').EU_IT_PRELIMINARY_TEMPLATE.sourceSnapshot)")"
export CHROMA_ENDPOINT=http://127.0.0.1:8000
export GOOGLE_APPLICATION_CREDENTIALS="$key_file"

cd "$repository_root/vera"
pnpm --filter @vera/label-runner build
exec node apps/label-runner/dist/main.js
