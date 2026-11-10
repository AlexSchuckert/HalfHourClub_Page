#!/usr/bin/env bash
# Run ON THE SERVER to switch to a new release:
#
#   bash activate-release.sh /path/to/halfhourclubs-YYYYMMDD-HHMMSS.zip
#
# Layout (under $APP, default ~/halfhourclubs):
#   releases/<timestamp>/   one unpacked release each; old ones are kept
#   current -> releases/…   what the site and the scheduled job use
#   shared/config.local.php private settings, never inside a release
#   shared/storage/         photos, videos, display copies, backups
#
# The switch is a single symlink rename, so visitors never see half a release.
# To roll back, point `current` at the previous release the same way.
set -euo pipefail
APP=${HHC_APP:-$HOME/halfhourclubs}
ZIP=${1:?Give the release zip to activate}
[ -f "$APP/shared/config.local.php" ] || { echo "Create $APP/shared/config.local.php first (see docs/OPERATIONS.md)." >&2; exit 1; }
STAMP=$(basename "$ZIP" .zip | sed 's/^halfhourclubs-//')
DEST="$APP/releases/$STAMP"
[ -e "$DEST" ] && { echo "$DEST already exists." >&2; exit 1; }
mkdir -p "$DEST" && unzip -q "$ZIP" -d "$DEST"
ln -s "$APP/shared/config.local.php" "$DEST/config.local.php"
rmdir "$DEST/storage" 2>/dev/null || true
chmod -R go-rwx "$DEST" && chmod -R go+rX "$DEST/public"   # only public/ is readable by the web server
( cd "$DEST" && php bin/console.php install )                # tables use IF NOT EXISTS: safe to repeat
ln -sfn "$DEST" "$APP/current.next" && mv -Tf "$APP/current.next" "$APP/current"
echo "Active: $DEST"
