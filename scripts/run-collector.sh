#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${ROOT_DIR}/run"
LOCK_FILE="${LOCK_DIR}/collector.lock"
LOG_FILE="${LOCK_DIR}/collector.log"
STATUS_FILE="${LOCK_DIR}/collector-status.json"
TIMEZONE_VALUE="${COLLECTOR_TIMEZONE:-Asia/Shanghai}"
LOOKBACK_DAYS_VALUE="${COLLECTOR_LOOKBACK_DAYS:-14}"
VOLUME_LOOKBACK_DAYS_VALUE="${COLLECTOR_VOLUME_LOOKBACK_DAYS:-45}"
AUDIT_WINDOW_DAYS_VALUE="${INTEGRITY_AUDIT_WINDOW_DAYS:-30}"
AUDIT_END_OFFSET_DAYS_VALUE="${INTEGRITY_AUDIT_END_OFFSET_DAYS:-1}"
AUDIT_OUTPUT_PATH="${ROOT_DIR}/run/collector-recent-integrity.json"
AUTO_REMEDIATE_VALUE="${COLLECTOR_AUTO_REMEDIATE:-true}"
REMEDIATE_MAX_LOOKBACK_DAYS_VALUE="${COLLECTOR_REMEDIATE_MAX_LOOKBACK_DAYS:-90}"

mkdir -p "${LOCK_DIR}"

write_status() {
  local status="$1"
  local detail="${2:-}"
  local now
  now="$(date -Is)"
  python3 - "$STATUS_FILE" "$status" "$now" "$LOG_FILE" "$detail" "$TIMEZONE_VALUE" "$LOOKBACK_DAYS_VALUE" "$VOLUME_LOOKBACK_DAYS_VALUE" "$AUDIT_OUTPUT_PATH" <<'PY'
import json
import os
import sys

(
    path,
    status,
    now,
    log_file,
    detail,
    timezone_value,
    lookback_days,
    volume_lookback_days,
    audit_output_path,
) = sys.argv[1:]
payload = {
    "status": status,
    "generated_at": now,
    "log_file": log_file,
    "detail": detail,
    "timezone": timezone_value,
    "funding_lookback_days": int(lookback_days),
    "volume_lookback_days": int(volume_lookback_days),
    "integrity_report": audit_output_path,
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
  echo "Collector is already running. Skip this run."
  exit 0
fi

write_status "running" "collector_started"
trap 'write_status "failed" "collector_failed"' EXIT

cd "${ROOT_DIR}"
python binance_coin_funding_rate_collector.py \
  --timezone "${TIMEZONE_VALUE}" \
  --lookback-days "${LOOKBACK_DAYS_VALUE}" \
  --volume-lookback-days "${VOLUME_LOOKBACK_DAYS_VALUE}"

python scripts/audit_recent_daily_integrity.py \
  --timezone "${TIMEZONE_VALUE}" \
  --window-days "${AUDIT_WINDOW_DAYS_VALUE}" \
  --end-offset-days "${AUDIT_END_OFFSET_DAYS_VALUE}" \
  --output "${AUDIT_OUTPUT_PATH}"

if [[ "${AUTO_REMEDIATE_VALUE}" == "true" ]]; then
  python scripts/remediate_recent_daily_integrity.py \
    --report "${AUDIT_OUTPUT_PATH}" \
    --timezone "${TIMEZONE_VALUE}" \
    --window-days "${AUDIT_WINDOW_DAYS_VALUE}" \
    --end-offset-days "${AUDIT_END_OFFSET_DAYS_VALUE}" \
    --current-lookback-days "${LOOKBACK_DAYS_VALUE}" \
    --current-volume-lookback-days "${VOLUME_LOOKBACK_DAYS_VALUE}" \
    --max-lookback-days "${REMEDIATE_MAX_LOOKBACK_DAYS_VALUE}" \
    --execute
fi

trap - EXIT
write_status "success" "collector_finished"
