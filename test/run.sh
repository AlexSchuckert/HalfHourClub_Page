#!/usr/bin/env bash
# Run every test: build the encrypted site, serve it, drive it in a browser.
#
#   npm test
#
# Point HHC_CONTENT_DIR at a local checkout to avoid cloning the content repo:
#   HHC_CONTENT_DIR=../HalfHourClub_Content npm test
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${HHC_TEST_PORT:-8899}"
export HHC_TEST_URL="http://localhost:${PORT}"
export HHC_TEST_PASSWORD="test-family-password"

echo "── Private key handling ──────────────────────────────"
node test/private-key.test.mjs

echo
echo "── Functions ─────────────────────────────────────────"
node test/functions.test.mjs

echo
echo "── Building the encrypted site ───────────────────────"
HHC_PASSWORD="$HHC_TEST_PASSWORD" \
HHC_PUBLISH_KEY="test-publish-key" \
  bash scripts/build.sh > /tmp/hhc-test-build.log 2>&1 ||
  { echo "Build failed:"; tail -20 /tmp/hhc-test-build.log; exit 1; }
echo "built"

# Playwright is only needed for the browser tests, so it isn't a dependency of
# the site itself.
if ! node -e "require.resolve('playwright')" 2>/dev/null; then
  echo "Installing playwright (test-only)…"
  npm install --no-save --no-audit --no-fund playwright > /dev/null 2>&1
fi

python3 -m http.server "$PORT" --directory _site > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

echo
echo "── Site ──────────────────────────────────────────────"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 node test/site.test.mjs

echo
echo "── Media pipelines ───────────────────────────────────"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 node test/media.test.mjs

echo
echo "All tests passed."
