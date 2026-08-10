#!/usr/bin/env bash
# Build AND encrypt locally, exactly as Netlify does — for testing the password
# gate before pushing.
#
# Usage:
#   HHC_PASSWORD='whatever-you-set' ./scripts/build-encrypted.sh
#
# Then open ./_site/index.html and try the password.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${HHC_PASSWORD:?Set HHC_PASSWORD first, e.g. HHC_PASSWORD=test ./scripts/build-encrypted.sh}"

exec bash scripts/build.sh
