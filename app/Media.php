<?php
declare(strict_types=1);
/*
 * Photos and videos are private files, served only to signed-in devices.
 * Originals sit in storage/media/<sha256>; display copies (long edge 1600px) are
 * generated on first request into storage/display/ and are disposable.
 *
 * The browser already shrinks photos to ≤3 MB and compresses videos before
 * uploading, so these limits only catch something that bypassed the form.
 */

const MEDIA_TYPES = [
    'image/jpeg' => ['jpg', 4 * 1024 * 1024],
    'image/png' => ['png', 4 * 1024 * 1024],
    'video/mp4' => ['mp4', 52 * 1024 * 1024],
    'video/webm' => ['webm', 52 * 1024 * 1024],
    'video/quicktime' => ['mov', 52 * 1024 * 1024],
];
const DISPLAY_EDGE = 1600;

function media_dir(string $kind): string {
    $dir = config('storage') . '/' . $kind;
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    return $dir;
}

/** Keep an uploaded file and return its public name (what contributions refer to). */
function store_media(string $file): array {
    $size = filesize($file);
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file);
    if (!isset(MEDIA_TYPES[$mime])) throw new InvalidArgumentException('Only JPEG or PNG photos and MP4, WebM or MOV videos can be added.');
    [$extension, $limit] = MEDIA_TYPES[$mime];
    if (!$size || $size > $limit) throw new InvalidArgumentException('That file is too large (' . round($limit / 1048576) . ' MB at most).');
    if (str_starts_with($mime, 'image/') && !@getimagesize($file)) throw new InvalidArgumentException('That photo could not be read.');
    $sha = hash_file('sha256', $file);
    $target = media_dir('media') . '/' . $sha;
    if (!is_file($target)) {
        $temp = tempnam(dirname($target), 'upload-');
        if (!copy($file, $temp) || !rename($temp, $target)) throw new RuntimeException('Could not keep the file.');
    }
    // 128 random bits: a name nobody can guess, though files need a sign-in anyway.
    $name = bin2hex(random_bytes(16)) . '.' . $extension;
    query('INSERT INTO media (name, sha256, mime, size) VALUES (?, ?, ?, ?)', [$name, $sha, $mime, $size]);
    return ['name' => $name, 'mime' => $mime, 'size' => $size];
}

/** A smaller copy for reading the page; the original stays available full-screen. */
function display_copy(array $m): ?string {
    if (!in_array($m['mime'], ['image/jpeg', 'image/png'], true) || !function_exists('imagecreatetruecolor')) return null;
    $target = media_dir('display') . '/' . $m['sha256'] . '-' . DISPLAY_EDGE . '.jpg';
    if (is_file($target)) return $target;
    $source = config('storage') . '/media/' . $m['sha256'];
    $info = @getimagesize($source);
    if (!$info || $info[0] * $info[1] > 40_000_000) return null;
    if (max($info[0], $info[1]) <= DISPLAY_EDGE && $m['size'] < 600_000) return null; // already small
    $image = $m['mime'] === 'image/png' ? @imagecreatefrompng($source) : @imagecreatefromjpeg($source);
    if (!$image) return null;
    $scale = min(1, DISPLAY_EDGE / max($info[0], $info[1]));
    $w = max(1, (int)round($info[0] * $scale)); $h = max(1, (int)round($info[1] * $scale));
    $copy = imagecreatetruecolor($w, $h);
    imagefill($copy, 0, 0, imagecolorallocate($copy, 255, 255, 255));
    imagecopyresampled($copy, $image, 0, 0, 0, 0, $w, $h, $info[0], $info[1]);
    $temp = tempnam(dirname($target), 'display-');
    $ok = imagejpeg($copy, $temp, 82);
    unset($copy, $image);
    if (!$ok) { unlink($temp); return null; }
    rename($temp, $target);
    return $target;
}

/**
 * Send a file. Authorisation has already happened (see Http.php), including for
 * conditional requests: a 304 is only ever sent to a signed-in device.
 *
 * A name always maps to the same bytes, so browsers may keep files for a year —
 * no revalidation round trip on every page view. Byte ranges let video seek
 * without downloading the whole clip first.
 */
function serve_media(string $name, bool $display): void {
    $m = one('SELECT m.* FROM media m LEFT JOIN clubs c ON c.id = m.club_id WHERE m.name = ? AND (m.club_id IS NULL OR c.deleted_at IS NULL)', [$name]);
    $file = $m ? config('storage') . '/media/' . $m['sha256'] : null;
    if (!$m || !is_file($file)) throw new HttpError(404, 'That file is not here.');
    $mime = $m['mime'];
    if ($display && ($copy = display_copy($m)) && filesize($copy) < filesize($file)) { $file = $copy; $mime = 'image/jpeg'; }

    $etag = '"' . $m['sha256'] . ($file === config('storage') . '/media/' . $m['sha256'] ? '' : '-d') . '"';
    header('Cache-Control: private, max-age=31536000, immutable');
    header('ETag: ' . $etag);
    header('X-Content-Type-Options: nosniff');
    if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); return; }

    $size = filesize($file); $start = 0; $end = $size - 1;
    header('Accept-Ranges: bytes');
    header('Content-Type: ' . $mime);
    header('Content-Disposition: inline; filename="' . $name . '"');
    $range = $_SERVER['HTTP_RANGE'] ?? '';
    if ($range !== '') {
        if (!preg_match('/^bytes=(\d*)-(\d*)$/D', $range, $r) || ($r[1] === '' && $r[2] === '')) {
            http_response_code(416); header("Content-Range: bytes */$size"); return;
        }
        if ($r[1] === '') { $start = max(0, $size - (int)$r[2]); }          // last N bytes
        else { $start = (int)$r[1]; if ($r[2] !== '') $end = min($end, (int)$r[2]); }
        if ($start > $end || $start >= $size) { http_response_code(416); header("Content-Range: bytes */$size"); return; }
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') return;
    $in = fopen($file, 'rb'); fseek($in, $start);
    for ($left = $end - $start + 1; $left > 0 && !feof($in); $left -= 1048576) echo fread($in, (int)min(1048576, $left));
    fclose($in);
}

/** Uploads never saved into a club, and files nothing points at any more. */
function purge_orphans(): int {
    query('DELETE FROM media WHERE club_id IS NULL AND created_at < UTC_TIMESTAMP() - INTERVAL 1 DAY');
    $keep = array_flip(array_column(rows('SELECT DISTINCT sha256 FROM media'), 'sha256'));
    $removed = 0;
    foreach (glob(media_dir('media') . '/*') ?: [] as $file) {
        // Skip anything touched in the last hour: an upload writes its file a moment
        // before its row exists.
        if (preg_match('/^[a-f0-9]{64}$/D', basename($file)) && !isset($keep[basename($file)]) && filemtime($file) < time() - 3600) { unlink($file); $removed++; }
    }
    foreach (glob(media_dir('display') . '/*.jpg') ?: [] as $file) {
        if (!isset($keep[substr(basename($file), 0, 64)])) unlink($file);
    }
    return $removed;
}
