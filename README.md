# Half Hour Club (build repo)

A private, password-protected archive of our **half hour clubs** — thirty-minute
sessions where the family makes something from a shared prompt. **Netlify**
builds it for free and serves an encrypted site.

Everyone uses **one shared family password**. No GitHub account, no second
token, no per-person login: type the password, read everything, and add a new
club from the same page.

## Two repos — and why

| Repo | Holds | Who can write |
|------|-------|---------------|
| **`HalfHourClub_Content`** (private) | The archive: club markdown, photos, videos | Anyone with the family password, through the site's form |
| **`HalfHourClub_Page`** (this one, private) | Build pipeline, theme, functions, **and the secrets** | Only you |

The split is a deliberate safety boundary, the same one the mooring wiki uses.
The credential the publishing form gets can write to the *content* repo only,
which has **no build scripts and no secrets** — so a family member can add a
poem but cannot steal the reader password or hijack the build. As a second
layer, the build (here, out of their reach) runs contributed markdown through a
[sanitiser](lib/render.mjs) that **strips any `<script>` or other executable
HTML**, so injected code can't reach readers either.

## How it works

```
  family member on a phone
        │  types the ONE shared password (StatiCrypt AES gate)
        ▼
  Netlify site ── /new/ ──POST /api/auth──▶ Netlify function
   (every .html          (publish key,       holds the GitHub App key,
    encrypted)            baked INSIDE       returns a 1-hour token
        │                 the encrypted      scoped to the content repo
        │                 page)                        │
        │                    browser commits straight to GitHub
        │                    (one commit, media included)
        ▼                                              ▼
  HalfHourClub_Page (private)  ◀── build ───  HalfHourClub_Content (private)
   Eleventy templates, theme,     fetch         clubs/**.md + media/
   functions, build scripts       content       push → Action → build hook
```

Every page is **encrypted with the shared password** before publishing, so the
content is genuinely protected, not merely unlinked.

### Why the browser talks to GitHub directly

Netlify caps a function's request body at 6 MB, and a compressed video can be
50 MB — so media cannot be relayed through a function. Instead the function is
only an **auth broker**: it checks the publish key and hands back a **GitHub App
installation token** that expires in an hour and works on one repo. Nothing
long-lived ever sits in a browser, and there's no yearly token to renew.

### Why the publish key is safe in the page

`/new/index.html` carries the key, and `scripts/build.sh` encrypts every page.
The key is inside the AES ciphertext, so only someone who already typed the
family password can read it. That's what makes "one password" honest — and it's
why, unlike the mooring wiki's `/admin`, **`/new/` is encrypted too**.

---

## One-time setup

You'll create one GitHub App and set five environment variables. That's it.

### 1. Connect this repo to Netlify

1. Sign in at <https://app.netlify.com> (you can use "Log in with GitHub").
2. **Add new site → Import an existing project → GitHub**.
3. Authorise Netlify and pick **`HalfHourClub_Page`** (the build repo — *not*
   the content repo).
4. Netlify reads [`netlify.toml`](netlify.toml) automatically, so the build
   command and publish directory are already filled in. Click **Deploy**.

The first deploy will **fail** — expected, the secrets below aren't set yet.

### 2. Set the family password

**Site configuration → Environment variables → Add a variable**

- `HHC_PASSWORD` — the shared password everyone will type (tick "Contains
  secret values").

### 3. Create a publish key

Any long random string. It gates the two functions. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- `HHC_PUBLISH_KEY` — that string (tick "Contains secret values").

Nobody needs to know or type this — it's baked into the encrypted page.

### 4. Create the GitHub App

This is the single machine credential. It's used both by the build (to read the
content repo) and by the form (to write to it).

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**
   - **Name:** anything, e.g. "Half Hour Club publisher"
   - **Homepage URL:** your Netlify address
   - **Webhook:** untick **Active** (we don't use webhooks)
   - **Permissions → Repository permissions → Contents:** *Read and write*
   - **Where can this App be installed:** *Only on this account*
   - Click **Create GitHub App**.
2. On the App's page, note the **App ID**.
3. Scroll to **Private keys → Generate a private key**. A `.pem` file
   downloads — keep it safe, it's a secret.
4. Left sidebar → **Install App** → install it on your account, and choose
   **Only select repositories → `HalfHourClub_Content`**.
5. After installing, the browser URL ends in a number:
   `…/settings/installations/12345678`. That number is the **installation ID**.

Now add three more Netlify environment variables:

- `HHC_GH_APP_ID` — the App ID from step 2
- `HHC_GH_APP_INSTALLATION_ID` — the number from step 5
- `HHC_GH_APP_PRIVATE_KEY` — the private key (tick "Contains secret values").
  **Store it base64-encoded** — Netlify's field is single line, and a PEM is
  not:

  ```bash
  base64 -w0 your-app-key.pem      # macOS: base64 -i your-app-key.pem
  ```

  Paste that one line as the value; the build decodes it. Pasting the raw PEM
  usually works too — [`scripts/gh-app-token.mjs`](scripts/gh-app-token.mjs)
  repairs newlines turned into spaces, literal `\n`, CRLF, stray quotes and
  missing `BEGIN`/`END` markers — but base64 has nothing left to mangle.

Then **Deploys → Trigger deploy → Deploy site**. It should go green.

> **If the build fails with `error:1E08010C:DECODER routines::unsupported`**,
> that's this key. It reads like a Node or OpenSSL version problem and isn't —
> the PEM lost its line breaks on the way into the settings field. Check the
> value without deploying:
>
> ```bash
> HHC_GH_APP_PRIVATE_KEY='<paste the value>' npm run check:key
> ```
>
> It reports whether the key parses, and says what to fix if not, without ever
> printing the key itself.

### 5. Make new clubs publish themselves

So that adding a club rebuilds the site:

1. Netlify: **Site configuration → Build & deploy → Build hooks → Add build
   hook**. Copy the URL.
2. GitHub → **`HalfHourClub_Content`** → **Settings → Secrets and variables →
   Actions → New repository secret**:
   - `NETLIFY_BUILD_HOOK` — that URL.

The workflow already in the content repo does the rest.

### 6. Share it

Send the family **the link and the password**. Nothing else.

#### The secrets, at a glance

| Secret | Lives where | Who gets it |
|--------|-------------|-------------|
| **`HHC_PASSWORD`** | Netlify env | Everyone in the family |
| **`HHC_PUBLISH_KEY`** | Netlify env | Nobody (baked into the encrypted page) |
| **GitHub App private key** | Netlify env | Nobody (machine only) |
| **`NETLIFY_BUILD_HOOK`** | content-repo Actions secret | Nobody (machine only) |

---

## Adding and editing clubs

Open the site, tap **＋ New half hour club**, and fill in the form. It prefills
the date, a half-hour slot and your location, takes dragged-in photos and
videos, and writes everything in one commit. The club appears about a minute
later.

To correct something, open the club and tap **Edit this club** (or go to
`/new/?edit=<slug>`). The same form loads it, saves changes, or deletes it.

### What happens to photos and videos

All of it happens on the device, before anything is uploaded:

- **Photos** → JPEG, long edge at most 2560px, **at most 3 MB**. Re-encoding
  also drops the EXIF block, which removes the GPS coordinates phones stamp into
  photos.
- **Videos** → H.264 + AAC in MP4, at most 1080p, about **19 MB per minute**,
  hard limit 50 MB. Longer clips get a lower bitrate rather than a bigger file,
  dropping to 720p if that would look better. Browsers without H.264 use
  VP9/WebM instead; the rare browser with neither uploads the original if it's
  under the limit.
- **iPhone HEIC** photos are decoded with a converter that loads only when
  it's actually needed.

## Local development

```bash
npm install

# Preview against your local copy of the content repo — no cloning, no gate
HHC_CONTENT_DIR=../HalfHourClub_Content ./scripts/serve.sh   # localhost:8080

# Or let it clone the content repo over SSH using your own GitHub access
./scripts/serve.sh
```

Test the password gate exactly as Netlify builds it:

```bash
HHC_CONTENT_DIR=../HalfHourClub_Content \
HHC_PASSWORD=test-password \
HHC_PUBLISH_KEY=anything \
  ./scripts/build.sh
(cd _site && python3 -m http.server 8899)   # then open localhost:8899
```

There are browser tests for the gate, the calendar and both media pipelines —
see [test/README.md](test/README.md).

## Project layout

| Path | What it is |
|------|------------|
| `src/index.njk` | Home: calendar, categories, contributors, recent clubs |
| `src/club.njk` | One page per club — header, prompt, collapsed contributions |
| `src/category.njk`, `src/contributor.njk` | The two blog-like index pages |
| `src/new.njk` + `src/assets/new/` | The add/edit/delete form and its media pipelines |
| `src/_data/clubs.js` | Reads the archive; derives categories, contributors, calendar |
| `lib/render.mjs` | Markdown → **sanitised** HTML, media paths, video players |
| `lib/dates.mjs` | "Monday 10th August 2026", "11:00–11:45" |
| `netlify/functions/` | `auth` (token broker) and `geocode` (location lookup) |
| `templates/gate.html` | The password gate, restyled from StatiCrypt's own |
| `scripts/build.sh` | The full build Netlify runs (fetch → build → encrypt) |
| `scripts/gh-app-token.mjs` | Mints the 1-hour GitHub token; shared by build and function |
| `test/` | Browser tests |

## Good to know

- **Search is deliberately absent.** A search index would be a plaintext file
  next to the encrypted pages, handing over every poem to anyone who found the
  URL. The calendar and the two index pages cover browsing. For the same reason
  the calendar's data is **inlined into the page**, never written to a `.json`.
- **Media files are not encrypted.** StatiCrypt only encrypts `.html`, so
  photos and videos under `/clubs/*/media/` are reachable by direct URL. Their
  filenames are random hex and appear only inside encrypted pages, so they can't
  be guessed or crawled — but this is the one thing the password doesn't cover.
  It's the same trade-off the mooring wiki makes with `img/`.
- **Adding a category needs no config change.** Type it into the form's category
  box. `categories.yml` in the content repo only pins order and colour.
- **The branch is never assumed.** `/api/auth` asks the content repo for its own
  default branch and the form uses that, so it always writes where the build
  reads (`git clone` checks out the default branch too). If you keep the archive
  somewhere other than the default branch, set `HHC_CONTENT_BRANCH` in Netlify.
  A repo whose first push was a feature branch has no `main` at all, which is
  why nothing here hardcodes one.
- **Anyone with the password can add, edit and delete.** That's the design: one
  password, a visible ＋ button. The blast radius is small — the token is scoped
  to the content repo, expires in an hour, and every change is a git commit you
  can revert.
- **Rotating the password** means changing `HHC_PASSWORD` in Netlify and
  redeploying. Everyone re-enters it once. Keep the **salt** in
  `scripts/build.sh` as it is — it isn't secret, and changing it would log
  everyone out on every deploy.
- **The password is symmetric and shared**, so treat it like a door key: fine
  for a family, not a substitute for per-person accounts. If you outgrow it, the
  upgrade path is Netlify Identity or Cloudflare Access.
