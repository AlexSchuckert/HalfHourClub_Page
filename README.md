# Half Hour Clubs

A private, password-protected archive of our **half hour clubs**: thirty-minute
sessions where the family makes something from a shared prompt.

It's a small PHP and MySQL site, hosted in an Alwaysdata account of its own.
Saving a club takes about a tenth of a second, and the club is live straight
away.

- **One family password**, asked once per device. The sign-in lasts a year.
- An **Edit** button at the top right of every club page opens that club in the
  form.
- **New** prefills today's date, the time and your location. Photos and videos
  are compressed in the browser and upload while you type.
- Photos and videos are private: every file is checked against the sign-in
  before it's served. Phones get a lighter display copy of each photo, and the
  lightbox opens the original.

## Layout

```
app/          the application: routes, sign-in, clubs, media, markdown, backups
views/        page templates
public/       document root: front controller, CSS/JS, vendored editor and media libraries
database/     schema.sql
bin/          console.php (admin commands), package.php, activate-release.sh
tests/        run.php (integration), http.sh (HTTP defences), browser.cjs (end to end)
docs/         OPERATIONS.md, the hosting runbook
```

Content lives in the database, and photos and videos live in `storage/` on the
server. The repository holds only code, so its size doesn't grow with the
archive.

## Local development

You need PHP 8.3+ with the extensions listed in `composer.json`, Composer, and
MySQL 8 or MariaDB 10.6+.

```sh
composer install
cp config.example.php config.local.php     # set dsn, db_user, db_password, and a secret:
php -r 'echo bin2hex(random_bytes(32)), "\n";'
php bin/console.php install
HHC_NEW_PASSWORD=local-family-pw php bin/console.php password
php bin/console.php import ../HalfHourClub_Content    # optional: the old archive
php -d upload_max_filesize=60M -d post_max_size=64M -S 127.0.0.1:8000 -t public public/router.php
```

## Tests

```sh
php tests/run.php                       # integration; uses the hhc_test database (see the file's header)
HHC_TEST_URL=http://127.0.0.1:8000 HHC_TEST_PASSWORD=local-family-pw bash tests/http.sh
HHC_TEST_URL=http://127.0.0.1:8000 HHC_TEST_PASSWORD=local-family-pw node tests/browser.cjs   # needs Playwright
```

GitHub Actions runs the first two on every push.

## Admin commands

`php bin/console.php <command>`:

| Command | Does |
|---|---|
| `install` | Creates the tables; safe to re-run |
| `password` | Sets the family password and signs every device out |
| `import <dir>` | One-off import of the old `HalfHourClub_Content` repository |
| `maintenance` | Removes uploads that never made it into a club |
| `backup-key <file>` / `backup <key>` / `restore <file> <key>` | Encrypted backups |
| `deleted` / `undelete <slug>` | Deleted clubs are hidden, never erased |

Hosting, deployment, backups and recovery are covered in
[docs/OPERATIONS.md](docs/OPERATIONS.md).
