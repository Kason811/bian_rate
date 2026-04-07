#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${ROOT_DIR}/run"
LOCK_FILE="${LOCK_DIR}/collector.lock"
TIMEZONE_VALUE="${COLLECTOR_TIMEZONE:-Asia/Shanghai}"

mkdir -p "${LOCK_DIR}"

source "${ROOT_DIR}/.venv/bin/activate"
export PYTHONUNBUFFERED=1

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Collector is already running. Skip this run."
  exit 0
fi

cd "${ROOT_DIR}"
exec python binance_coin_funding_rate_collector.py --timezone "${TIMEZONE_VALUE}"
