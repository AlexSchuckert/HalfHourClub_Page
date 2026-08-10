#!/usr/bin/env bash
# Live local preview (unencrypted) at http://localhost:8080
#
# Pulls the latest club archive, then watches src/ and content/ and rebuilds on
# change. No password gate — that's added at publish time by scripts/build.sh.
#
# Tip: to preview against a local checkout of the content repo instead of
# cloning it, point HHC_CONTENT_DIR at it:
#
#   HHC_CONTENT_DIR=../HalfHourClub_Content ./scripts/serve.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install --no-audit --no-fund
fi

bash scripts/fetch-content.sh

echo "Starting preview at http://localhost:8080  (press Ctrl+C to stop)"
exec npx @11ty/eleventy --serve
