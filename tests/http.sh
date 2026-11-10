#!/usr/bin/env bash
# HTTP-level checks against a running dev server (see README): the defences an
# attacker would meet from outside. Uses the local dev database.
#
#   HHC_TEST_URL=http://127.0.0.1:8000 HHC_TEST_PASSWORD=... bash tests/http.sh
set -uo pipefail
B=${HHC_TEST_URL:-http://127.0.0.1:8000}
PW=${HHC_TEST_PASSWORD:-local-family-pw}
J=$(mktemp); trap 'rm -f "$J"' EXIT
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  PASS  $1"; else fail=$((fail+1)); echo "  FAIL  $1 — expected $3, got $2"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check 'Pages redirect to sign-in when signed out'        "$(code "$B/")" 303
check 'API refuses signed-out requests'                  "$(code -X POST -H 'Content-Type: application/json' -d '{}' "$B/api/clubs")" 401
check 'Media refuses signed-out requests'                "$(code "$B/media/0123456789abcdef.jpg")" 401
check 'Health check is open'                             "$(curl -s "$B/health/")" ok
check 'Sign in'                                          "$(code -c "$J" -d "password=$PW" "$B/login/")" 303
check 'Signed-in save without CSRF token is refused'     "$(code -b "$J" -X POST -H 'Content-Type: application/json' -d '{}' "$B/api/clubs")" 403
check 'Signed-in upload without CSRF token is refused'   "$(code -b "$J" -F "file=@$0" "$B/api/media")" 403
check 'A post from another site is refused'              "$(code -b "$J" -H 'Origin: https://evil.example' -X POST -d '' "$B/logout/")" 403
check 'Sign-in redirects stay on this site'              "$(curl -s -o /dev/null -w '%{redirect_url}' -b "$J" "$B/login/?next=//evil.example/")" "$B/"
check 'Paths cannot climb out of assets'                 "$(code -b "$J" "$B/assets/../../config.local.php")" 404
check 'Unknown media is a 404, not an error'             "$(code -b "$J" "$B/media/0123456789abcdef.jpg")" 404
H=$(curl -s -D - -o /dev/null -b "$J" "$B/")
check 'Pages send a Content-Security-Policy'             "$(grep -ci '^content-security-policy:' <<<"$H")" 1
check 'Pages are not cached by shared caches'            "$(grep -ci '^cache-control: no-store' <<<"$H")" 1
check 'Search engines are told to stay away'             "$(grep -ci '^x-robots-tag: noindex' <<<"$H")" 1
CSRF=$(curl -s -b "$J" "$B/new/" | grep -o '"csrf":"[a-f0-9]*"' | cut -d'"' -f4)
check 'An invalid club is refused with a reason'         "$(code -b "$J" -X POST -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' -d '{"title":"","date":"x"}' "$B/api/clubs")" 422
check 'Sign out'                                         "$(code -b "$J" -c "$J" -X POST -d "csrf=$CSRF" "$B/logout/")" 303
check 'Signed out means signed out'                      "$(code -b "$J" "$B/")" 303

echo; echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
