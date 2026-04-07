#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${ROOT_DIR}/run"
LOCK_FILE="${LOCK_DIR}/research-4h-cache.lock"
LOG_FILE="${LOCK_DIR}/research-4h-cache.log"
STATUS_FILE="${LOCK_DIR}/research-4h-cache-status.json"
INTEGRITY_REPORT="${LOCK_DIR}/research-4h-cache-integrity.json"
AUDIT_WINDOW_DAYS_VALUE="${RESEARCH_4H_AUDIT_WINDOW_DAYS:-14}"
AUTO_REMEDIATE_VALUE="${RESEARCH_4H_AUTO_REMEDIATE:-true}"

mkdir -p "${LOCK_DIR}"

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
  "timeframe": "4h",
  "integrity_report": os.path.join(os.path.dirname(path), "research-4h-cache-integrity.json"),
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

source "${ROOT_DIR}/.venv/bin/activate"
export PYTHONUNBUFFERED=1

exec > >(tee -a "${LOG_FILE}") 2>&1

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "4h cache refresh is already running. Skip this run."
  exit 0
fi

write_status "running" "research_4h_cache_started"
trap 'write_status "failed" "research_4h_cache_failed"' EXIT

cd "${ROOT_DIR}"
python scripts/backfill_research_4h_klines.py
python scripts/audit_recent_research_intraday_integrity.py \
  --window-days "${AUDIT_WINDOW_DAYS_VALUE}" \
  --output "${INTEGRITY_REPORT}"

if [[ "${AUTO_REMEDIATE_VALUE}" == "true" ]]; then
  python scripts/remediate_research_4h_cache_integrity.py \
    --report "${INTEGRITY_REPORT}" \
    --window-days "${AUDIT_WINDOW_DAYS_VALUE}" \
    --execute
fi

trap - EXIT
write_status "success" "research_4h_cache_finished"
