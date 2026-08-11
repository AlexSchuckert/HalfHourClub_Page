# Tests

Two browser tests, because almost everything worth checking here only happens in
a browser: the password gate decrypts client side, and photos and videos are
compressed on the device before upload.

## Running them

```bash
# 1. Build the real, encrypted site
HHC_CONTENT_DIR=../HalfHourClub_Content \
HHC_PASSWORD=test-family-password \
HHC_PUBLISH_KEY=any-non-empty-string \
  ./scripts/build.sh

# 2. Serve it
(cd _site && python3 -m http.server 8899 &)

# 3. Run
npm install --no-save playwright
node test/site.test.mjs
node test/media.test.mjs
```

Both honour `HHC_TEST_URL` (default `http://localhost:8899`), and the site test
honours `HHC_TEST_PASSWORD`. Chromium is located automatically; override with
`CHROMIUM_PATH` if needed.

## `private-key.test.mjs` — 18 checks

Runs on its own (`npm run test:key`), no browser or build needed.

The GitHub App key has to survive being pasted into a single-line settings
field, and every mangling here has been seen for real: newlines turned into
spaces or tabs, literal `\n`, CRLF, surrounding quotes, `BEGIN`/`END` markers
lost, the whole PEM base64-encoded. Each one used to fail with the same
misleading `error:1E08010C:DECODER routines::unsupported`. The checks confirm
each form still signs verifiably, that genuinely bad input fails with a message
that says what to do, and that **no error message ever quotes key material** —
build logs are kept.

## `site.test.mjs` — 22 checks

The reading experience, against the encrypted output:

- content is unreadable before the password, and a wrong password is refused
- the right password decrypts, and browsing to another page doesn't ask again
  (that's the pre-ticked "Remember me" in `templates/gate.html`)
- the calendar opens on the month that has clubs, shows a blue dot per club day,
  and clicking a dot opens that club
- the club header carries location, date and the start–end range, plus the prompt
- contributions are all collapsed on arrival, are labelled
  "contributor — category", and expand when clicked
- both serif fonts actually load
- the `/new/` form prefills today's date and a half-hour slot, offers every
  configured category, and refuses to publish an empty club
- no JavaScript errors anywhere

## `media.test.mjs` — 15 checks

The two compression pipelines, with real files made in the browser:

- a 4000×3000 noise photo (39 MB PNG — noise is the worst case for JPEG) comes
  out **under 3 MB**, capped at 2560px, aspect ratio intact
- a canvas-recorded WebM clip is really transcoded, into a container and codec
  that plays, under the 50 MB cap, reporting progress as it goes
- the adaptive bitrate ladder: a short clip gets the full 2.5 Mbps at 1080p, a
  five-minute clip is throttled to stay inside the budget, an hour-long clip
  drops to 720p at the floor bitrate, and a 480p source is never upscaled

### One thing these tests cannot cover

Playwright's Chromium is built without the patent-encumbered codecs, so
`canEncodeVideo('avc')` is false here and the test exercises the **VP9/WebM**
rung of the ladder rather than the preferred **H.264/MP4** one. Real Chrome,
Edge and Safari — i.e. every device the family will actually use — have H.264
and AAC, and take the first rung. Both rungs run the same code path, so what's
verified is the transcode itself; which codec comes out is the browser's answer
to `canEncodeVideo`, not a branch that goes untested.

To confirm the H.264 path, run the media test against a real Chrome:

```bash
CHROMIUM_PATH=/path/to/google-chrome node test/media.test.mjs
```
