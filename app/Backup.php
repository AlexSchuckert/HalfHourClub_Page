<?php
declare(strict_types=1);
/*
 * Encrypted backups: a ZIP of every table as
 * JSON plus every media original, encrypted with libsodium's authenticated
 * streaming encryption. Restore refuses a non-empty database and checks every
 * file's checksum. Display copies are not backed up; they regenerate.
 */

// Insert order respects foreign keys.
const BACKUP_TABLES = ['settings', 'categories', 'people', 'clubs', 'contributions', 'contribution_people', 'media', 'slug_redirects'];
const BACKUP_MAGIC = 'HHCLUB1';

function backup_key(string $path): string {
    $text = trim((string)@file_get_contents($path));
    if (!preg_match('/^[a-f0-9]{64}$/D', $text)) throw new RuntimeException('The backup key must be 64 hexadecimal characters.');
    return hex2bin($text);
}

function encrypt_backup(string $source, string $destination, string $key): void {
    [$state, $header] = sodium_crypto_secretstream_xchacha20poly1305_init_push($key);
    $in = fopen($source, 'rb'); $out = fopen($destination, 'xb');
    if (!$out) throw new RuntimeException('Backup destination already exists.');
    fwrite($out, BACKUP_MAGIC . $header);
    try {
        while (!feof($in)) {
            $chunk = fread($in, 1048576);
            $tag = feof($in) ? SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL : 0;
            $cipher = sodium_crypto_secretstream_xchacha20poly1305_push($state, $chunk, '', $tag);
            fwrite($out, pack('N', strlen($cipher)) . $cipher);
        }
    } finally { fclose($in); fclose($out); }
}

function decrypt_backup(string $source, string $destination, string $key): void {
    $in = fopen($source, 'rb'); $out = fopen($destination, 'wb');
    try {
        if (fread($in, strlen(BACKUP_MAGIC)) !== BACKUP_MAGIC) throw new RuntimeException('Not a Half Hour Clubs backup.');
        $header = fread($in, SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_HEADERBYTES);
        $state = sodium_crypto_secretstream_xchacha20poly1305_init_pull($header, $key); $final = false;
        while (!feof($in)) {
            $length = fread($in, 4); if ($length === '') break;
            if (strlen($length) !== 4 || $final) throw new RuntimeException('Damaged backup framing.');
            $size = unpack('N', $length)[1];
            if ($size < 17 || $size > 1048576 + 17) throw new RuntimeException('Invalid backup block.');
            $cipher = ''; while (strlen($cipher) < $size && !feof($in)) $cipher .= fread($in, $size - strlen($cipher));
            $plain = sodium_crypto_secretstream_xchacha20poly1305_pull($state, $cipher);
            if ($plain === false) throw new RuntimeException('Backup authentication failed — wrong key, or the file is damaged.');
            [$chunk, $tag] = $plain; fwrite($out, $chunk);
            $final = $tag === SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL;
        }
        if (!$final) throw new RuntimeException('Truncated backup.');
    } finally { fclose($in); fclose($out); }
}

const BACKUPS_KEPT = 7;

function create_backup(string $keyFile): string {
    $key = backup_key($keyFile);
    $dir = media_dir('backups');
    $temp = tempnam($dir, 'snapshot-'); $zip = new ZipArchive(); $zip->open($temp, ZipArchive::OVERWRITE);
    try {
        atomic(function () use ($zip) {
            foreach (BACKUP_TABLES as $table) $zip->addFromString("database/$table.json", json_encode(rows("SELECT * FROM $table"), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
            foreach (rows('SELECT DISTINCT sha256 FROM media') as $m) {
                $file = config('storage') . '/media/' . $m['sha256'];
                if (!is_file($file) || hash_file('sha256', $file) !== $m['sha256']) throw new RuntimeException("Media integrity check failed for {$m['sha256']} — not backing up a damaged archive.");
                $zip->addFile($file, 'media/' . $m['sha256']);
                $zip->setCompressionName('media/' . $m['sha256'], ZipArchive::CM_STORE); // already compressed
            }
            $zip->addFromString('manifest.json', json_encode(['format' => 1, 'created_at' => gmdate('c'), 'schema_sha256' => hash_file('sha256', ROOT . '/database/schema.sql')]));
        });
        if (!$zip->close()) throw new RuntimeException('Could not finish the backup archive.');
        $target = $dir . '/halfhourclubs-' . gmdate('Ymd-His') . '-' . substr(new_id(), 0, 6) . '.enc';
        encrypt_backup($temp, "$target.part", $key);
        if (!rename("$target.part", $target)) throw new RuntimeException('Could not commit the encrypted backup.');
        // Each backup is a full copy of every photo and video, so keep only the newest few.
        $all = glob("$dir/halfhourclubs-*.enc") ?: []; sort($all);
        foreach (array_slice($all, 0, -BACKUPS_KEPT) as $file) unlink($file);
        return $target;
    } finally {
        if (is_file($temp)) unlink($temp);
        if (isset($target) && is_file("$target.part")) unlink("$target.part");
    }
}

function restore_backup(string $source, string $keyFile): void {
    foreach (BACKUP_TABLES as $table) if (one("SELECT 1 FROM $table LIMIT 1")) throw new RuntimeException('Restore needs a freshly installed, empty database.');
    $temp = tempnam(config('storage'), 'restore-'); $zip = new ZipArchive();
    try {
        decrypt_backup($source, $temp, backup_key($keyFile));
        if ($zip->open($temp) !== true) throw new RuntimeException('Invalid backup archive.');
        $manifest = json_decode($zip->getFromName('manifest.json'), true, 512, JSON_THROW_ON_ERROR);
        if (($manifest['format'] ?? 0) !== 1 || $manifest['schema_sha256'] !== hash_file('sha256', ROOT . '/database/schema.sql')) {
            throw new RuntimeException('Restore with the same version of the application as made the backup.');
        }
        $data = [];
        foreach (BACKUP_TABLES as $table) $data[$table] = json_decode($zip->getFromName("database/$table.json"), true, 512, JSON_THROW_ON_ERROR);
        $dir = media_dir('media');
        foreach (array_unique(array_column($data['media'], 'sha256')) as $sha) {
            if (!preg_match('/^[a-f0-9]{64}$/D', $sha)) throw new RuntimeException('Invalid media key.');
            $input = $zip->getStream("media/$sha"); if (!$input) throw new RuntimeException("Missing media $sha in backup.");
            $output = fopen("$dir/$sha", 'wb'); stream_copy_to_stream($input, $output); fclose($input); fclose($output);
            if (hash_file('sha256', "$dir/$sha") !== $sha) throw new RuntimeException("Restored media $sha failed its checksum.");
        }
        atomic(function () use ($data) {
            foreach (BACKUP_TABLES as $table) {
                $allowed = array_column(rows("SHOW COLUMNS FROM $table"), 'Field');
                foreach ($data[$table] as $record) {
                    if (array_diff(array_keys($record), $allowed)) throw new RuntimeException("Unexpected columns in $table.");
                    query("INSERT INTO $table (`" . implode('`,`', array_keys($record)) . '`) VALUES (' . implode(',', array_fill(0, count($record), '?')) . ')', array_values($record));
                }
            }
        });
    } finally { if (is_file($temp)) unlink($temp); }
}
