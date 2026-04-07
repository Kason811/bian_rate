#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"

cd "${WEB_DIR}"

if [[ ! -f .next-runtime/BUILD_ID ]]; then
  npm run build
fi

exec npm run start
