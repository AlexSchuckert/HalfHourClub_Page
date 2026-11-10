# Hosting and operations

Half Hour Clubs runs in the agenda's Alwaysdata account (`agendacollectif`,
Small plan) as a **separate site**, with its own folder, database, database user
and scheduled task. Neither app uses anything of the other's, so either can be
removed on its own (see [Removing the agenda later](#removing-the-agenda-later)).
Only deleting the *account* would remove both.

One limit to know about: both sites run as the same server user. A security
hole in one app would expose the other's files, including its database password.
Keep both up to date. If that ever matters more than the cost, an account of its
own (*Subscriptions → Open a new account*) gives full isolation. The code works
there unchanged; only the paths below change.

Deployment is manual over SSH, like the agenda's. GitHub Actions only runs the
tests.

## Requirements

PHP 8.3 or newer (the account runs 8.4 on the command line and 8.5 for the web,
both fine), MySQL 8 or MariaDB 10.6+, and the PDO MySQL, mbstring, fileinfo, GD,
Zip, Sodium and cURL extensions. No Node, no build step.

## Server layout

Everything for Half Hour Clubs is under one folder, next to the agenda's
`releases/`, `shared/` and `public/`, never inside them:

```
/home/agendacollectif/halfhourclubs/
  releases/<timestamp>/     one unpacked release each; old ones are kept for rollback
  current -> releases/…     what the site and the scheduled job use
  shared/config.local.php   private settings, never inside a release
  shared/storage/           photos, videos, display copies and backups
  shared/backup.key         the backup encryption key (keep a copy elsewhere too)
```

The site's document root is `/home/agendacollectif/halfhourclubs/current/public`.
Never point it at the release root: `config.local.php`, `vendor/` and `app/`
must not be web-reachable.

## First-time setup

1. **Database.** In the Alwaysdata admin: *Databases → MySQL → Add a database*,
   e.g. `agendacollectif_hhc`, and *Add a user* with access to **that database
   only**. Don't reuse the agenda's database user.
2. **Site.** The address is **`halfhourclubs.com`**. Add it under *Domains →
   Add a domain*. Then add a site under *Web → Sites → Add a site*: type PHP,
   addresses `halfhourclubs.com`, root
   `/home/agendacollectif/halfhourclubs/current/public`, with *Force HTTPS* on.
   Add a second site of type *Redirect* from `www.halfhourclubs.com` to
   `https://halfhourclubs.com`, so everyone signs in on one address (sign-in is
   per address). Then point the domain's DNS at Alwaysdata: either set its
   nameservers to Alwaysdata's, or keep the DNS where it is and add the records
   the admin shows. Alwaysdata issues the HTTPS certificate once DNS points at it.
3. **PHP limits.** Videos are compressed in the browser to 50 MB at most.
   `public/.user.ini` raises the upload limits to match
   (`upload_max_filesize=60M`, `post_max_size=64M`). If the host ignores
   `.user.ini`, set the same values in the site's PHP settings in the admin.
4. **Build a release** on your computer and upload it:

   ```sh
   composer install --no-dev
   php bin/package.php          # → storage/releases/halfhourclubs-….zip
   scp storage/releases/halfhourclubs-….zip agendacollectif@ssh-agendacollectif.alwaysdata.net:
   ```

5. **Configure** over SSH:

   ```sh
   mkdir -p ~/halfhourclubs/{releases,shared/storage}
   chmod 700 ~/halfhourclubs/shared
   unzip -p halfhourclubs-….zip config.example.php > ~/halfhourclubs/shared/config.local.php
   chmod 600 ~/halfhourclubs/shared/config.local.php
   # then edit it and set:
   #   'env' => 'production'
   #   'url' => 'https://halfhourclubs.com'
   #   'dsn' => 'mysql:host=mysql-agendacollectif.alwaysdata.net;dbname=agendacollectif_hhc;charset=utf8mb4'
   #   'db_user', 'db_password' from step 1
   #   'storage' => '/home/agendacollectif/halfhourclubs/shared/storage'
   #   'secret' => output of: php -r 'echo bin2hex(random_bytes(32)), "\n";'
   ```

6. **Activate** (creates the tables, then switches `current`):

   ```sh
   unzip -p halfhourclubs-….zip bin/activate-release.sh > ~/halfhourclubs/activate-release.sh
   bash ~/halfhourclubs/activate-release.sh ~/halfhourclubs-….zip
   ```

7. **Family password:**

   ```sh
   cd ~/halfhourclubs/current && php bin/console.php password
   ```

8. **Import the old archive** (once). Copy the `HalfHourClub_Content` repository
   to the server, import it, then delete the copy:

   ```sh
   cd ~/halfhourclubs/current && php bin/console.php import ~/HalfHourClub_Content
   ```

   It refuses to run twice. Ask the family not to add clubs on the old site
   between the copy and the switch, or they'll be missed.

9. **Backups.** Create the key once, and keep a second copy **off the server**;
   without it, backups cannot be opened:

   ```sh
   cd ~/halfhourclubs/current && php bin/console.php backup-key ~/halfhourclubs/shared/backup.key
   ```

   Then add a **separate** scheduled task (*Advanced → Scheduled tasks*), daily
   at 03:50 so it doesn't overlap the agenda's 03:30 job:

   ```sh
   cd /home/agendacollectif/halfhourclubs/current && php bin/console.php maintenance && php -d memory_limit=512M bin/console.php backup /home/agendacollectif/halfhourclubs/shared/backup.key
   ```

   Backups land in `shared/storage/backups/`, encrypted. The seven newest are
   kept. They are only on the same server until you copy them elsewhere, so
   download one now and then. Alwaysdata also keeps 7 days of its own backups
   of the account.

10. **Uptime.** Set the repository variable `HEALTH_URL` to
    `https://halfhourclubs.com/health/` and `.github/workflows/availability.yml`
    checks it every 15 minutes.

## Deploying an update

Run the tests, build a new zip, upload it, run `activate-release.sh` on it. The
previous release stays in `releases/`. To roll back:
`ln -sfn ~/halfhourclubs/releases/<previous> ~/halfhourclubs/current`.

## Recovery

Restore into a **new, empty** database with the same application version that
made the backup:

```sh
HHC_CONFIG=/private/recovery/config.php php bin/console.php install
HHC_CONFIG=/private/recovery/config.php php -d memory_limit=512M bin/console.php restore backup.enc backup.key
```

Restore checks the encryption, every table and every file's checksum. It
refuses a database that already has data.

## Everyday operations

| Task | Command (in `~/halfhourclubs/current`) |
|---|---|
| Change the family password (signs every device out) | `php bin/console.php password` |
| See deleted clubs | `php bin/console.php deleted` |
| Bring one back | `php bin/console.php undelete <slug>` |
| Disk used by photos and videos | `du -sh ~/halfhourclubs/shared/storage/media` |
| Disk used by backups | `du -sh ~/halfhourclubs/shared/storage/backups` |

Deleting a club from the site only hides it, with all its files, so it can
always be undeleted. Uploads that never ended up in a saved club are removed by
the nightly maintenance after a day.

## Removing the agenda later

Remove the agenda's pieces one by one, and **do not delete the account**:

- its site in *Web → Sites*: the one rooted at `/home/agendacollectif/public`,
  not the one rooted at `…/halfhourclubs/current/public`;
- its database and database user in *Databases → MySQL*: not
  `agendacollectif_hhc` or its user;
- its scheduled task (the 03:30 one), its mail address if you no longer need
  it, and its folders `~/releases`, `~/shared` and `~/public`. Leave
  `~/halfhourclubs` alone.

Half Hour Clubs keeps running throughout. The account keeps its name; that only
shows in paths and the `mysql-agendacollectif` host, not to the family, since the
site has its own address, `halfhourclubs.com`.

## Disk space

The Small plan's 50 GB is shared with the agenda, and counts files, databases
and backups together. Plan for about nine times the size of the photos and
videos: the originals, seven backups (each a full copy), and room for the next
backup while it's being written. Display copies add roughly a quarter of each
photo's size on top. They regenerate, so `shared/storage/display/` can be
deleted at any time.

At the current ~2.4 MB per club that's a couple of thousand clubs. Videos (up
to 50 MB each) are what to watch.
