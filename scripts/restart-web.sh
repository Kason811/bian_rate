#!/usr/bin/env bash

set -euo pipefail

PORT="${PORT:-43126}"
HOST_NAME="${HOST_NAME:-0.0.0.0}"
WEB_DIR="${WEB_DIR:-web}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/${WEB_DIR}"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
OUT_LOG="${TARGET_DIR}/server-${TIMESTAMP}.out.log"
ERR_LOG="${TARGET_DIR}/server-${TIMESTAMP}.err.log"
HEALTH_URL="http://127.0.0.1:${PORT}/__health"

if [[ ! -d "${TARGET_DIR}" ]]; then
  echo "Web directory not found: ${TARGET_DIR}" >&2
  exit 1
fi

find_port_pids() {
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "${PORT}" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti TCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true
  else
    echo "Need fuser or lsof to manage port ${PORT}" >&2
    exit 1
  fi
}

PIDS="$(find_port_pids | xargs -r echo)"
if [[ -n "${PIDS}" ]]; then
  echo "Stopping listeners on port ${PORT}: ${PIDS}"
  kill ${PIDS}
  sleep 2
fi

cd "${TARGET_DIR}"
npm run build

nohup bash -lc "exec env PORT='${PORT}' HOST_NAME='${HOST_NAME}' npm run start" </dev/null >"${OUT_LOG}" 2>"${ERR_LOG}" &
LAUNCH_PID=$!

for _ in $(seq 1 60); do
  sleep 1

  if ! kill -0 "${LAUNCH_PID}" 2>/dev/null; then
    echo "Start process exited early. stderr:" >&2
    tail -n 60 "${ERR_LOG}" >&2 || true
    exit 1
  fi

  if curl --silent --fail "${HEALTH_URL}" >/dev/null 2>&1; then
    LISTENER_PIDS="$(find_port_pids | xargs -r echo)"
    echo "Ready on http://${HOST_NAME}:${PORT}"
    echo "Health URL: ${HEALTH_URL}"
    echo "Launcher PID: ${LAUNCH_PID}"
    echo "Listener PID(s): ${LISTENER_PIDS}"
    echo "stdout log: ${OUT_LOG}"
    echo "stderr log: ${ERR_LOG}"
    exit 0
  fi
done

echo "Health check did not pass in time: ${HEALTH_URL}" >&2
tail -n 60 "${ERR_LOG}" >&2 || true
exit 1
