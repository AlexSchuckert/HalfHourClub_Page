<?php
declare(strict_types=1);
/*
 * Integration tests. They reset ONLY the `hhc_test` database (configurable via
 * HHC_TEST_DSN / HHC_TEST_DB_USER / HHC_TEST_DB_PASSWORD) and a private
 * storage/tests/ directory. Never point them at live data.
 *
 *   php tests/run.php
 *   HHC_CONTENT_DIR=../HalfHourClub_Content php tests/run.php   # also tests the real import
 */
if (PHP_SAPI !== 'cli') exit(1);
$root = dirname(__DIR__);
$storage = "$root/storage/tests";
$dsn = getenv('HHC_TEST_DSN') ?: 'mysql:host=127.0.0.1;port=3306;dbname=hhc_test;charset=utf8mb4';
if (!str_contains($dsn, 'dbname=hhc_test')) { fwrite(STDERR, "Refusing: tests only run against a database named hhc_test.\n"); exit(1); }
exec('rm -rf ' . escapeshellarg($storage)); mkdir($storage, 0700, true);
file_put_contents("$storage/config.php", '<?php return ' . var_export([
    'env' => 'local', 'url' => 'http://127.0.0.1:8001', 'dsn' => $dsn,
    'db_user' => getenv('HHC_TEST_DB_USER') ?: 'hhc', 'db_password' => getenv('HHC_TEST_DB_PASSWORD') ?: 'hhc-local',
    'storage' => "$storage/files", 'secret' => str_repeat('ab', 32),
], true) . ';');
putenv("HHC_CONFIG=$storage/config.php");
require "$root/app/bootstrap.php";
require ROOT . '/app/Import.php';
require ROOT . '/app/Backup.php';

$passed = 0; $failed = 0;
function check(string $name, bool $ok, string $detail = ''): void {
    global $passed, $failed;
    $ok ? $passed++ : $failed++;
    echo ($ok ? '  PASS  ' : '  FAIL  ') . $name . ($detail !== '' ? " — $detail" : '') . "\n";
}
function throws(callable $fn, string $class = Throwable::class): string {
    try { $fn(); } catch (Throwable $e) { return $e instanceof $class ? ($e->getMessage() ?: get_class($e)) : 'WRONG: ' . get_class($e) . ' ' . $e->getMessage(); }
    return '';
}
function reset_db(): void {
    db()->exec('SET FOREIGN_KEY_CHECKS = 0');
    foreach (array_column(rows('SHOW TABLES'), array_key_first(rows('SHOW TABLES')[0] ?? ['x' => 0])) as $t) db()->exec("DROP TABLE `$t`");
    db()->exec('SET FOREIGN_KEY_CHECKS = 1');
    install_schema();
}
function sample(array $over = []): array {
    return read_club(array_replace(['title' => 'Jesus and cicadas', 'location' => 'Kardamyli', 'date' => '2026-08-10', 'start' => '11:00', 'end' => '11:45',
        'prompt' => 'Pretend to be Jesus', 'contributions' => [['contributors' => ['Ella'], 'category' => 'Poem', 'body' => "Line one\nline two"]]], $over));
}
function tiny_jpeg(string $path, int $w = 2400, int $h = 1800): void {
    $im = imagecreatetruecolor($w, $h);
    for ($i = 0; $i < 4000; $i++) imagefilledrectangle($im, random_int(0, $w), random_int(0, $h), random_int(0, $w), random_int(0, $h), random_int(0, 0xFFFFFF));
    imagejpeg($im, $path, 95);
}

echo "SCHEMA\n";
reset_db();
check('Installs cleanly, twice', throws(fn() => install_schema()) === '');

echo "\nSIGN-IN\n";
set_family_password('correct horse');
$_SERVER['REMOTE_ADDR'] = '203.0.113.7';
check('Signed out by default', !signed_in());
check('A wrong password fails', !attempt_sign_in('wrong horse'));
check('The right password signs in', attempt_sign_in('correct horse') && signed_in());
$cookie = $_COOKIE[AUTH_COOKIE];
[$exp] = explode('.', $cookie);
check('The cookie lasts a year', (int)$exp - time() > 364 * 86400);
$_COOKIE[AUTH_COOKIE] = substr($cookie, 0, -1) . (str_ends_with($cookie, 'a') ? 'b' : 'a');
check('A tampered cookie is refused', !signed_in());
$_COOKIE[AUTH_COOKIE] = '1000000000.' . explode('.', $cookie)[1] . '.' . auth_mac('1000000000.' . explode('.', $cookie)[1]);
check('An expired cookie is refused', !signed_in());
$_COOKIE[AUTH_COOKIE] = $cookie;
set_family_password('a brand new one');
check('Changing the password signs every device out', !signed_in());
check('Short passwords are refused', throws(fn() => set_family_password('short'), InvalidArgumentException::class) !== '');
query('DELETE FROM rate_limits');
for ($i = 0; $i < 10; $i++) attempt_sign_in('nope');
check('The eleventh attempt in 15 minutes is refused', str_contains(throws(fn() => attempt_sign_in('a brand new one'), HttpError::class), 'Too many'));
query('DELETE FROM rate_limits');

echo "\nSAVING\n";
$club = save_club(null, sample());
check('A new club gets a date-and-title address', $club['slug'] === '2026-08-10-jesus-and-cicadas', $club['slug']);
$again = save_club(null, sample());
check('A second club with the same name and date gets its own address', $again['slug'] === '2026-08-10-jesus-and-cicadas-2', $again['slug']);
$found = find_club($club['slug']);
check('Contributions and names come back in order', $found['contributions'][0]['people'] === ['Ella'] && $found['contributions'][0]['body'] === "Line one\nline two");
$edited = save_club($club['id'], sample(['title' => 'Jesus, cicadas and figs']), (int)$club['revision']);
check('Editing bumps the revision', (int)$edited['revision'] === (int)$club['revision'] + 1);
check('Renaming moves the address and remembers the old one', one('SELECT club_id FROM slug_redirects WHERE slug = ?', [$club['slug']])['club_id'] === $club['id']);
check('A stale edit is refused, not silently overwriting', str_contains(throws(fn() => save_club($club['id'], sample(), (int)$club['revision']), HttpError::class), 'Someone else'));
save_club(null, sample(['date' => '2026-08-12', 'title' => 'Holidays', 'contributions' => [['contributors' => ['ella', 'Alex'], 'category' => 'poem', 'body' => 'x']]]));
$h = find_club('2026-08-12-holidays');
check('Typed names and categories reuse existing spellings', $h['contributions'][0]['people'] === ['Ella', 'Alex'] && $h['contributions'][0]['category'] === 'Poem', json_encode($h['contributions'][0]['people']));
save_club(null, sample(['date' => '2026-08-13', 'title' => 'Sculpting', 'contributions' => [['contributors' => ['Mira'], 'category' => 'Sculpture', 'body' => 'clay']]]));
$colours = colours();
check('A new category gets a colour nobody else has', isset($colours['Sculpture']) && count(array_unique($colours)) === count($colours), json_encode($colours));
check('Bad dates are refused', throws(fn() => sample(['date' => '2026-02-30']), InvalidArgumentException::class) !== '');
check('Bad times are refused', throws(fn() => sample(['start' => '25:00']), InvalidArgumentException::class) !== '');
check('A contribution without a name is refused', throws(fn() => sample(['contributions' => [['contributors' => [], 'body' => 'x']]]), InvalidArgumentException::class) !== '');
check('Category and contributor indexes count clubs', category_index()[0]['name'] === 'Poem' && (int)category_index()[0]['clubs'] === 3);

echo "\nMEDIA\n";
$jpg = "$storage/photo.jpg"; tiny_jpeg($jpg);
$m = store_media($jpg);
check('Uploads get an unguessable 128-bit name', (bool)preg_match('/^[a-f0-9]{32}\.jpg$/', $m['name']), $m['name']);
$m2 = store_media($jpg);
check('Identical uploads share one file on disk', count(glob(config('storage') . '/media/*')) === 1);
$withPhoto = save_club(null, sample(['date' => '2026-09-01', 'title' => 'Photo club', 'contributions' => [['contributors' => ['Ella'], 'category' => 'Visual Art', 'body' => "![Drawing](media/{$m['name']})"]]]));
check('Saving attaches the files a club mentions', one('SELECT club_id FROM media WHERE name = ?', [$m['name']])['club_id'] === $withPhoto['id']);
check('A club cannot claim a file that belongs to another', str_contains(throws(fn() => save_club(null, sample(['date' => '2026-09-02', 'contributions' => [['contributors' => ['A'], 'body' => "media/{$m['name']}"]]])), InvalidArgumentException::class), 'another club'));
check('Unknown files are refused', str_contains(throws(fn() => save_club(null, sample(['date' => '2026-09-03', 'contributions' => [['contributors' => ['A'], 'body' => 'media/0123456789abcdef.jpg']]])), InvalidArgumentException::class), 'missing'));
$copy = display_copy(one('SELECT * FROM media WHERE name = ?', [$m['name']]));
$size = getimagesize($copy);
check('Display copies are 1600px on the long edge, and smaller', max($size[0], $size[1]) === 1600 && filesize($copy) < filesize($jpg), "$size[0]x$size[1], " . round(filesize($copy) / 1024) . ' KB vs ' . round(filesize($jpg) / 1024) . ' KB');
check('Other uploads must be photos or video', throws(fn() => store_media(__FILE__), InvalidArgumentException::class) !== '');
query("UPDATE media SET created_at = UTC_TIMESTAMP() - INTERVAL 2 DAY WHERE name = ?", [$m2['name']]);
purge_orphans();
check('Unused uploads are tidied after a day, shared files kept', !one('SELECT 1 FROM media WHERE name = ?', [$m2['name']]) && is_file(config('storage') . '/media/' . one('SELECT sha256 FROM media WHERE name = ?', [$m['name']])['sha256']));

echo "\nMARKDOWN\n";
$html = render_markdown("<script>alert(1)</script>\n\n[x](javascript:alert(2)) ![v](media/abcdef12.mp4) ![p](media/abcdef12.jpg)\n\nline\nbreak");
check('Raw HTML is escaped, never run', !str_contains($html, '<script') && str_contains($html, '&lt;script&gt;'));
check('javascript: links lose their href', !str_contains($html, 'javascript:'));
check('Video references become players', str_contains($html, '<video controls') && str_contains($html, 'src="/media/abcdef12.mp4"'));
check('Photos use display copies, full size on click', str_contains($html, 'src="/media/abcdef12.jpg?size=display" data-full="/media/abcdef12.jpg"'));
check('Single newlines are line breaks, for poems', str_contains($html, "line<br />\nbreak"));
check('Inline JSON cannot end its script element', !str_contains(inline_json(['t' => '</script>']), '</'));

echo "\nDELETING\n";
delete_club($withPhoto['id'], (int)$withPhoto['revision']);
check('Deleted clubs disappear from lists and addresses', !find_club($withPhoto['slug']) && !in_array($withPhoto['id'], array_column(club_cards(), 'id'), true));
purge_orphans();
check('…but keep their files, so undelete brings everything back', (bool)one('SELECT 1 FROM media WHERE name = ?', [$m['name']]));

echo "\nBACKUP AND RESTORE\n";
$key = "$storage/backup.key"; file_put_contents($key, bin2hex(random_bytes(32)));
$before = [];
foreach (BACKUP_TABLES as $t) $before[$t] = rows("SELECT * FROM $t");
$backups = config('storage') . '/backups';
@mkdir($backups, 0700, true);
for ($i = 1; $i <= 8; $i++) file_put_contents(sprintf('%s/halfhourclubs-2000010%d-000000-old%03d.enc', $backups, $i, $i), 'old');
$backup = create_backup($key);
$kept = glob("$backups/halfhourclubs-*.enc");
check('Only the 7 newest backups are kept', count($kept) === 7 && in_array($backup, $kept, true) && !is_file("$backups/halfhourclubs-20000101-000000-old001.enc"), count($kept) . ' kept');
check('A backup is written, encrypted', is_file($backup) && !str_contains(file_get_contents($backup), 'Jesus'));
check('Restore refuses a non-empty database', str_contains(throws(fn() => restore_backup($backup, $key)), 'empty'));
$wrong = "$storage/wrong.key"; file_put_contents($wrong, bin2hex(random_bytes(32)));
reset_db();
exec('rm -rf ' . escapeshellarg(config('storage') . '/media'));
check('The wrong key is refused', str_contains(throws(fn() => restore_backup($backup, $wrong)), 'authentication'));
reset_db();
restore_backup($backup, $key);
$same = true;
foreach (BACKUP_TABLES as $t) if (rows("SELECT * FROM $t") != $before[$t]) { $same = false; echo "    differs: $t\n"; }
check('Every table comes back identical', $same);
check('Media files come back with matching checksums', hash_file('sha256', config('storage') . '/media/' . one('SELECT sha256 FROM media LIMIT 1')['sha256']) === one('SELECT sha256 FROM media LIMIT 1')['sha256']);

if ($content = getenv('HHC_CONTENT_DIR')) {
    echo "\nIMPORT FROM THE OLD REPOSITORY\n";
    reset_db();
    $counts = import_content($content, fn() => null);
    $folders = count(glob("$content/clubs/*/club.md"));
    check('Every club folder is imported', $counts['clubs'] === $folders, "{$counts['clubs']} of $folders");
    check('Every contribution file is imported', $counts['contributions'] === count(glob("$content/clubs/*/contributions/*.md")));
    check('Every media file is imported', $counts['media'] === count(glob("$content/clubs/*/media/*")));
    $missing = [];
    foreach (rows('SELECT body FROM contributions') as $r) {
        preg_match_all(MEDIA_REFERENCE, $r['body'], $mm);
        foreach ($mm[1] as $n) if (!one('SELECT 1 FROM media WHERE name = ?', [$n])) $missing[] = $n;
    }
    check('Every media reference resolves to a file', !$missing, implode(', ', $missing));
    check('Club addresses are unchanged', (bool)one('SELECT 1 FROM clubs WHERE slug = ?', ['2026-08-10-jesus-and-cicadas']));
    check('Importing twice is refused', str_contains(throws(fn() => import_content($content, fn() => null)), 'already'));
}

echo "\n$passed passed, $failed failed\n";
exit($failed ? 1 : 0);
