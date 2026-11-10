# Hosting and operations

Half Hour Clubs runs in an **Alwaysdata account of its own**, separate from the
agenda's (`agendacollectif`). Both can sit in the same Alwaysdata profile, one
login and one invoice, but each account has its own plan, files, databases,
SSH login and scheduled tasks. Deleting the agenda's account leaves this one
untouched, and the reverse is also true. Only deleting the whole *profile*
would remove both.

Deployment is manual over SSH. GitHub Actions only runs the tests.

Below, the account is called `halfhourclubs`. If that name is taken, pick
another and replace it everywhere it appears in these commands.

## Requirements

PHP 8.3 or newer, MySQL 8 or MariaDB 10.6+, and the PDO MySQL, mbstring,
fileinfo, GD, Zip, Sodium and cURL extensions. No Node, no build step.

## Server layout

```
/home/halfhourclubs/app/
  releases/<timestamp>/     one unpacked release each; old ones are kept for rollback
  current -> releases/…     what the site and the scheduled job use
  shared/config.local.php   private settings, never inside a release
  shared/storage/           photos, videos, display copies and backups
  shared/backup.key         the backup encryption key (keep a copy elsewhere too)
```

The site's document root is `/home/halfhourclubs/app/current/public`. Never
point it at the release root: `config.local.php`, `vendor/` and `app/` must not
be web-reachable.

## First-time setup

1. **Account.** In the Alwaysdata admin, go to *Subscriptions → Open a new
   account*. Name it `halfhourclubs`, choose Public Cloud, and pick a plan:
   - **Small** (€5/month paid yearly, or €6 monthly; 50 GB): the one to use.
   - **Free** (1 GB, including the database and the backups) can work to start,
     but only while the archive is small. Each backup is a full copy, and seven
     are kept, so 1 GB holds an archive of roughly 100 MB. A free account is
     also suspended if nobody logs into the admin for 120 days. You can upgrade
     later under *Subscriptions*, and everything stays where it is.

   Then switch the admin's account selector (top of the page) to
   `halfhourclubs` for every step below.
2. **PHP.** *Environment → PHP*: choose 8.4 or newer.
3. **Database.** *Databases → MySQL*: add a database, e.g.
   `halfhourclubs_archive`, and a user with access to it.
4. **Site.** *Web → Sites*: edit the default site, or add one, of type PHP, with
   root `/home/halfhourclubs/app/current/public`. Its address is
   `halfhourclubs.alwaysdata.net`, which every account gets for free. On a paid
   plan you can add your own domain or subdomain instead. Enable *Force
   HTTPS*.
5. **PHP limits.** Videos are compressed in the browser to 50 MB at most.
   `public/.user.ini` raises the upload limits to match
   (`upload_max_filesize=60M`, `post_max_size=64M`). If the host ignores
   `.user.ini`, set the same values in the site's PHP settings in the admin.
6. **SSH.** *Remote access → SSH*: enable password login for the account's
   user. The commands below run after `ssh halfhourclubs@ssh-halfhourclubs.alwaysdata.net`.
7. **Build a release** on your computer:

   ```sh
   composer install --no-dev
   php bin/package.php          # → storage/releases/halfhourclubs-….zip
   scp storage/releases/halfhourclubs-….zip halfhourclubs@ssh-halfhourclubs.alwaysdata.net:
   ```

8. **Configure** on the server:

   ```sh
   mkdir -p ~/app/{releases,shared/storage}
   chmod 700 ~/app/shared
   unzip -p halfhourclubs-….zip config.example.php > ~/app/shared/config.local.php
   chmod 600 ~/app/shared/config.local.php
   # then edit it and set:
   #   'env' => 'production'
   #   'url' => 'https://halfhourclubs.alwaysdata.net'   (or your own address)
   #   'dsn' => 'mysql:host=mysql-halfhourclubs.alwaysdata.net;dbname=halfhourclubs_archive;charset=utf8mb4'
   #   'db_user', 'db_password' from step 3
   #   'storage' => '/home/halfhourclubs/app/shared/storage'
   #   'secret' => output of: php -r 'echo bin2hex(random_bytes(32)), "\n";'
   ```

9. **Activate** (creates the tables, then switches `current`):

   ```sh
   unzip -p halfhourclubs-….zip bin/activate-release.sh > ~/app/activate-release.sh
   bash ~/app/activate-release.sh ~/halfhourclubs-….zip
   ```

10. **Family password:**

    ```sh
    cd ~/app/current && php bin/console.php password
    ```

11. **Import the old archive** (once). Copy the `HalfHourClub_Content` repository
    to the server, import it, then delete the copy:

    ```sh
    cd ~/app/current && php bin/console.php import ~/HalfHourClub_Content
    ```

    It refuses to run twice. Ask the family not to add clubs on the old site
    between the copy and the switch, or they'll be missed.

12. **Backups.** Create the key once, and keep a second copy **off the server**;
    without it, backups cannot be opened:

    ```sh
    cd ~/app/current && php bin/console.php backup-key ~/app/shared/backup.key
    ```

    Then add a scheduled task (*Advanced → Scheduled tasks*), daily, e.g. at
    03:50:

    ```sh
    cd /home/halfhourclubs/app/current && php bin/console.php maintenance && php -d memory_limit=512M bin/console.php backup /home/halfhourclubs/app/shared/backup.key
    ```

    Backups land in `shared/storage/backups/`, encrypted. The seven newest are
    kept. They are only on the same server until you copy them elsewhere, so
    download one now and then. Alwaysdata also keeps its own rolling backups of
    the account: 7 days on Small, 3 on Free.

13. **Uptime.** Set the repository variable `HEALTH_URL` to
    `https://<your address>/health/` and `.github/workflows/availability.yml`
    checks it every 15 minutes.

## Deploying an update

Run the tests, build a new zip, upload it, run `activate-release.sh` on it. The
previous release stays in `releases/`. To roll back:
`ln -sfn ~/app/releases/<previous> ~/app/current`.

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

| Task | Command (in `~/app/current`) |
|---|---|
| Change the family password (signs every device out) | `php bin/console.php password` |
| See deleted clubs | `php bin/console.php deleted` |
| Bring one back | `php bin/console.php undelete <slug>` |
| Disk used by photos and videos | `du -sh ~/app/shared/storage/media` |
| Disk used by backups | `du -sh ~/app/shared/storage/backups` |

Deleting a club from the site only hides it, with all its files, so it can
always be undeleted. Uploads that never ended up in a saved club are removed by
the nightly maintenance after a day.

## Disk space

The plan's quota counts files, databases and backups together. Plan for about
nine times the size of the photos and videos: the originals, seven backups
(each a full copy), and room for the next backup while it's being written.
Display copies add roughly a quarter of each photo's size on top. They
regenerate, so `shared/storage/display/` can be deleted at any time.

At the current ~2.4 MB per club, Small's 50 GB holds a couple of thousand
clubs. Videos (up to 50 MB each) are what to watch.
