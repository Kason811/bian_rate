#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"
RUN_DIR="${ROOT_DIR}/run"
LOG_FILE="${RUN_DIR}/web-service.log"
STATUS_FILE="${RUN_DIR}/web-service-status.json"

mkdir -p "${RUN_DIR}"

write_status() {
  local status="$1"
  local detail="${2:-}"
  local now
  now="$(date -Is)"
  python3 - "$STATUS_FILE" "$status" "$now" "$LOG_FILE" "$detail" <<'PY'
import json
import os
import sys

path, status, now, log_file, detail = sys.argv[1:]
payload = {
    "status": status,
    "generated_at": now,
    "log_file": log_file,
    "detail": detail,
}
if os.path.exists(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            previous = json.load(fh)
    except Exception:
        previous = {}
    started_at = previous.get("started_at")
    if started_at:
        payload["started_at"] = started_at
if status == "running":
    payload["started_at"] = now
else:
    payload["finished_at"] = now
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, indent=2)
PY
}

exec > >(tee -a "${LOG_FILE}") 2>&1

cd "${WEB_DIR}"

write_status "running" "starting_next_web"

if [[ ! -f .next-runtime/BUILD_ID ]]; then
  npm run build
fi

trap 'write_status "failed" "web_service_exited"' EXIT
npm run start
trap - EXIT
write_status "success" "web_service_stopped"
