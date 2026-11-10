# Hosting and operations

Half Hour Clubs runs on the same Alwaysdata account as the agenda
(`agendacollectif`, Small plan), as a second site with its own database and
database user, so neither site can read the other's data. Deployment is manual
over SSH, like the agenda's; GitHub Actions only runs tests.

## Requirements

PHP 8.3 or newer (the agenda's account runs 8.4 on the command line and 8.5 for
the web, both fine), MySQL 8 or MariaDB 10.6+, and the PDO MySQL, mbstring,
fileinfo, GD, Zip, Sodium and cURL extensions. No Node, no build step.

## Server layout

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
   only**.
2. **Site.** *Web → Sites → Add a site*: type PHP, root
   `/home/agendacollectif/halfhourclubs/current/public`, and an address. A
   subdomain of a domain you own is simplest; check in the admin which
   addresses Alwaysdata offers on this account. Enable *Force HTTPS*.
3. **PHP limits.** Videos are compressed in the browser to 50 MB at most.
   `public/.user.ini` raises the upload limits to match
   (`upload_max_filesize=60M`, `post_max_size=64M`). If the host ignores
   `.user.ini`, set the same values in the site's PHP settings in the admin.
4. **Build a release** on your computer:

   ```sh
   composer install --no-dev
   php bin/package.php          # → storage/releases/halfhourclubs-….zip
   ```

5. **Upload and configure** over SSH:

   ```sh
   mkdir -p ~/halfhourclubs/{releases,shared/storage}
   chmod 700 ~/halfhourclubs/shared
   # copy config.example.php from the zip to ~/halfhourclubs/shared/config.local.php, then set:
   #   'env' => 'production'
   #   'url' => 'https://<your address>'
   #   'dsn' => 'mysql:host=mysql-agendacollectif.alwaysdata.net;dbname=agendacollectif_hhc;charset=utf8mb4'
   #   'db_user', 'db_password' from step 1
   #   'storage' => '/home/agendacollectif/halfhourclubs/shared/storage'
   #   'secret' => output of: php -r 'echo bin2hex(random_bytes(32)), "\n";'
   chmod 600 ~/halfhourclubs/shared/config.local.php
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

   Then add a scheduled task (*Advanced → Scheduled tasks*), daily at 03:50 so it
   doesn't overlap the agenda's 03:30 job:

   ```sh
   cd /home/agendacollectif/halfhourclubs/current && php bin/console.php maintenance && php -d memory_limit=512M bin/console.php backup /home/agendacollectif/halfhourclubs/shared/backup.key
   ```

   Backups land in `shared/storage/backups/`, encrypted, and are kept for 30 days.
   Like the agenda's, they are only on the same server until you copy them
   elsewhere. Download one now and then.

10. **Uptime.** Set the repository variable `HEALTH_URL` to
    `https://<your address>/health/` and `.github/workflows/availability.yml`
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

Deleting a club from the site only hides it, with all its files, so it can
always be undeleted. Uploads that never ended up in a saved club are removed by
the nightly maintenance after a day.

## Disk space

The Small plan's 50 GB is shared with the agenda. At the current ~2.4 MB per
club that's tens of thousands of clubs; videos (up to 50 MB each) are what to
watch. Display copies roughly add a quarter on top of each photo, and
regenerate, so `shared/storage/display/` can be deleted at any time.
