#!/usr/bin/env bash
# The build command Netlify runs (wired up in netlify.toml).
#
# Fetches the club archive from the private content repo, builds the site with
# Eleventy, then encrypts every page with the one shared family password. The
# publishable result is left in ./_site
#
# Required environment variable (set in the Netlify dashboard, NOT in git):
#   HHC_PASSWORD     the single shared password the family types
#
# Also expected, for the "＋ New half hour club" form to work:
#   HHC_PUBLISH_KEY             gates the Netlify functions
#   HHC_GH_APP_ID               \
#   HHC_GH_APP_PRIVATE_KEY       > GitHub App with Contents write on the
#   HHC_GH_APP_INSTALLATION_ID  /  content repo
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${HHC_PASSWORD:-}" ]; then
  echo "ERROR: HHC_PASSWORD environment variable is not set." >&2
  echo "Add it in Netlify under Site configuration → Environment variables, then redeploy." >&2
  exit 1
fi

# Not fatal — the site still builds and reads fine, the form just can't publish.
if [ -z "${HHC_PUBLISH_KEY:-}" ]; then
  echo "WARNING: HHC_PUBLISH_KEY is not set — the '＋ New half hour club' form will be disabled." >&2
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies…"
  npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
fi

# Pull the club archive into ./content
bash scripts/fetch-content.sh

echo "Building site…"
rm -rf _site encrypted
npx @11ty/eleventy

echo "Encrypting every page with the shared password…"
# A FIXED salt is essential: without it StatiCrypt derives a different key every
# build, which invalidates everyone's saved "Remember me" login — so the family
# would retype the password after every single edit. The salt is NOT secret (it
# sits in the published HTML); only the password protects the content, so
# hardcoding it here is safe.
#
# Note there is no exception for the publishing form the way the mooring wiki
# leaves /admin in the clear: /new/ carries the publish key inside it, so it
# MUST be encrypted along with everything else.
#
# templates/gate.html is StatiCrypt's own template with two changes: it wears
# the site's palette and serif type (the gate is the first thing anyone sees),
# and its "Remember me" box starts ticked — without that, every link would ask
# for the password again, which makes the archive miserable to browse.
npx --yes staticrypt@3.5.4 _site --recursive --short \
  --password "$HHC_PASSWORD" \
  --salt 0a72f195e7473ba8fa77a858d0e70e2e \
  --remember 365 \
  --template templates/gate.html \
  --template-title "Half Hour Club" \
  --template-instructions "Thirty minutes, one prompt, whatever we make. Enter the family password to look inside." \
  --template-button "Come in" \
  --template-placeholder "Family password" \
  --template-remember "Stay signed in on this device" \
  --template-error "That's not the password — try again." \
  --directory encrypted

# StatiCrypt writes encrypted HTML to encrypted/_site/ but not the CSS, fonts or
# media. Overlay the encrypted pages back over the built site (which has the
# assets), so the published _site/ = encrypted pages + assets.
cp -R encrypted/_site/. _site/
rm -rf encrypted

echo "Build complete: ./_site is ready to publish."
