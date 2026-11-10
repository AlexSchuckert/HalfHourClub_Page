<?php
declare(strict_types=1);
/*
 * Operator commands. Run from the application directory:
 *
 *   php bin/console.php install                     create the tables
 *   php bin/console.php password                    set or change the family password
 *   php bin/console.php import <content-dir>        one-off import from HalfHourClub_Content
 *   php bin/console.php maintenance                 tidy unused uploads (daily)
 *   php bin/console.php backup-key <file>           create a backup key, once
 *   php bin/console.php backup <keyfile>            encrypted backup (daily)
 *   php bin/console.php restore <file> <keyfile>    into a freshly installed database
 *   php bin/console.php deleted                     list deleted clubs
 *   php bin/console.php undelete <slug>             bring one back
 */
if (PHP_SAPI !== 'cli') exit(1);
require __DIR__ . '/../app/bootstrap.php';
require ROOT . '/app/Import.php';
require ROOT . '/app/Backup.php';

$command = $argv[1] ?? '';
$arg = fn(int $i, string $what) => $argv[$i] ?? throw new InvalidArgumentException("Missing $what.");
try {
    switch ($command) {
        case 'install':
            install_schema();
            foreach (['media', 'display', 'backups'] as $dir) media_dir($dir);
            echo "Tables ready.\n";
            break;
        case 'password':
            $password = getenv('HHC_NEW_PASSWORD') ?: null;
            if ($password === null) {
                fwrite(STDOUT, 'New family password: ');
                if (stream_isatty(STDIN)) system('stty -echo');
                $password = rtrim((string)fgets(STDIN), "\r\n");
                if (stream_isatty(STDIN)) { system('stty echo'); echo "\n"; }
            }
            set_family_password($password);
            echo "Password set. Every device that was signed in will be asked for it again.\n";
            break;
        case 'import':
            $counts = import_content($arg(2, 'content directory'), fn($line) => print("  $line\n"));
            echo "Imported {$counts['clubs']} clubs, {$counts['contributions']} contributions, {$counts['media']} files.\n";
            break;
        case 'maintenance':
            query('DELETE FROM rate_limits WHERE expires_at < ?', [time()]);
            echo 'Removed ' . purge_orphans() . " unused files.\n";
            break;
        case 'backup-key':
            $path = $arg(2, 'key file path');
            if (file_exists($path)) throw new RuntimeException("$path already exists; not overwriting a key.");
            file_put_contents($path, bin2hex(random_bytes(32)) . "\n"); chmod($path, 0600);
            echo "Key written to $path. Keep a copy somewhere else: without it, backups cannot be opened.\n";
            break;
        case 'backup':
            echo create_backup($arg(2, 'key file')) . "\n";
            break;
        case 'restore':
            restore_backup($arg(2, 'backup file'), $arg(3, 'key file'));
            echo "Restored.\n";
            break;
        case 'deleted':
            foreach (rows('SELECT slug, title, deleted_at FROM clubs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC') as $c) echo "{$c['deleted_at']}  {$c['slug']}  ({$c['title']})\n";
            break;
        case 'undelete':
            $n = query('UPDATE clubs SET deleted_at = NULL, revision = revision + 1 WHERE slug = ? AND deleted_at IS NOT NULL', [$arg(2, 'slug')])->rowCount();
            echo $n ? "Restored.\n" : "No deleted club with that slug.\n";
            break;
        default:
            fwrite(STDERR, preg_replace('~^.*?\*\n|\*/.*$~s', '', file_get_contents(__FILE__)) . "\n");
            exit(2);
    }
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
