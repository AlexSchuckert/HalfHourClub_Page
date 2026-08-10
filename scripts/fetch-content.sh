#!/usr/bin/env bash
# Pull the club archive from the separate (private) content repo into ./content,
# so Eleventy can build it. The markdown is NOT stored in this build repo — it
# lives in the content repo that the publishing form writes to.
#
# Three ways it gets the content, in order of preference:
#
#   1. HHC_CONTENT_DIR points at a local checkout  → copy from there.
#      Handy when you have both repos side by side and want to preview an edit
#      without pushing it.
#   2. The GitHub App credentials are set          → mint a 1-hour token and
#      clone over HTTPS. This is what Netlify does.
#   3. Neither                                     → clone over SSH using your
#      own GitHub access.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTENT_REPO="AlexSchuckert/HalfHourClub_Content"
DEST="content"

rm -rf "$DEST"

if [ -n "${HHC_CONTENT_DIR:-}" ]; then
  echo "Using local content from ${HHC_CONTENT_DIR}…"
  if [ ! -d "${HHC_CONTENT_DIR}/clubs" ]; then
    echo "ERROR: ${HHC_CONTENT_DIR} doesn't look like the content repo (no clubs/ folder)." >&2
    exit 1
  fi
  mkdir -p "$DEST"
  # Copy the archive only — never the content repo's .git or workflows.
  for item in clubs categories.yml contributors.yml; do
    [ -e "${HHC_CONTENT_DIR}/${item}" ] && cp -R "${HHC_CONTENT_DIR}/${item}" "$DEST/"
  done
  echo "Content copied from ${HHC_CONTENT_DIR}."
  exit 0
fi

TMP=".content-src"
rm -rf "$TMP"

if [ -n "${HHC_GH_APP_ID:-}" ] && [ -n "${HHC_GH_APP_PRIVATE_KEY:-}" ]; then
  echo "Fetching content (GitHub App token)…"
  TOKEN="$(node scripts/gh-app-token.mjs)"
  git clone --depth 1 --quiet \
    "https://x-access-token:${TOKEN}@github.com/${CONTENT_REPO}.git" "$TMP"
  unset TOKEN
else
  echo "Fetching content (local, SSH)…"
  git clone --depth 1 --quiet "git@github.com:${CONTENT_REPO}.git" "$TMP"
fi

mkdir -p "$DEST"
for item in clubs categories.yml contributors.yml; do
  [ -e "$TMP/$item" ] && cp -R "$TMP/$item" "$DEST/"
done
rm -rf "$TMP"

echo "Content fetched from ${CONTENT_REPO}."
