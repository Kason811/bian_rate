#!/usr/bin/env bash

set -euo pipefail

MESSAGE="${1:-}"
PROXY_URL="${GIT_PROXY_URL:-}"

git_cmd() {
  if [[ -n "${PROXY_URL}" ]]; then
    git -c "http.proxy=${PROXY_URL}" -c "https.proxy=${PROXY_URL}" "$@"
  else
    git "$@"
  fi
}

git_cmd rev-parse --is-inside-work-tree >/dev/null
git_cmd pull --rebase

if [[ -z "$(git_cmd status --porcelain)" ]]; then
  git_cmd push
  exit 0
fi

git_cmd add -A

if [[ -z "${MESSAGE}" ]]; then
  MESSAGE="chore: sync $(date '+%F %R')"
elif [[ ! "${MESSAGE}" =~ ^[a-z]+:\  ]]; then
  MESSAGE="chore: ${MESSAGE}"
fi

git_cmd commit -m "${MESSAGE}"

if git_cmd rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git_cmd push
else
  CURRENT_BRANCH="$(git branch --show-current)"
  git_cmd push -u origin "${CURRENT_BRANCH}"
fi
