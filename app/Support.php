<?php
declare(strict_types=1);
class HttpError extends RuntimeException { public function __construct(public int $status, string $message) { parent::__construct($message); } }
function h(mixed $value): string { return htmlspecialchars((string)($value ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function redirect(string $path, int $status = 303): never {
    if (!safe_path($path)) throw new RuntimeException('Invalid redirect');
    header('Location: ' . $path, true, $status); exit;
}
/** A same-site path: no scheme, no host, no backslashes or control characters. */
function safe_path(string $path): bool { return str_starts_with($path, '/') && !str_starts_with($path, '//') && !preg_match('/[\\\\\x00-\x20]/', $path); }
function render(string $template, array $data = [], int $status = 200): void {
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    extract($data, EXTR_SKIP);
    ob_start(); require ROOT . '/views/' . $template . '.php'; $content = ob_get_clean();
    require ROOT . '/views/layout.php';
}
function partial(string $template, array $data = []): void { extract($data, EXTR_SKIP); require ROOT . '/views/' . $template . '.php'; }
function json_response(mixed $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}
/**
 * JSON for a <script type="application/json"> block. JSON_HEX_TAG turns < and >
 * into \u003C/\u003E so a club title containing </script> can't end the element
 * early; PHP already escapes U+2028/2029 unless told not to.
 */
function inline_json(mixed $data): string {
    return json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}
function request_json(): array {
    $data = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($data)) throw new HttpError(400, 'Expected a JSON body.');
    return $data;
}
/** Versioned asset URL, so browsers may cache assets for a year and still see changes. */
function asset(string $path): string {
    static $versions = [];
    $file = ROOT . '/public' . $path;
    $versions[$path] ??= is_file($file) ? substr(hash_file('sha256', $file), 0, 10) : '0';
    return $path . '?v=' . $versions[$path];
}
const ACCENTS = ['à'=>'a','á'=>'a','â'=>'a','ã'=>'a','ä'=>'a','å'=>'a','æ'=>'ae','ç'=>'c','è'=>'e','é'=>'e','ê'=>'e','ë'=>'e','ì'=>'i','í'=>'i','î'=>'i','ï'=>'i','ñ'=>'n','ò'=>'o','ó'=>'o','ô'=>'o','õ'=>'o','ö'=>'o','ø'=>'o','œ'=>'oe','ß'=>'ss','ù'=>'u','ú'=>'u','û'=>'u','ü'=>'u','ý'=>'y','ÿ'=>'y'];
/** Matches the slugs the previous site generated, so imported addresses keep working. */
function slugify(string $value): string {
    $value = strtr(mb_strtolower($value), ACCENTS);
    return trim(preg_replace('/[^a-z0-9]+/', '-', $value), '-');
}
/** "2026-08-10" → "Monday 10th August 2026" */
function date_label(string $iso): string {
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $iso);
    $day = (int)$d->format('j');
    $suffix = in_array($day, [11, 12, 13], true) ? 'th' : (['1' => 'st', '2' => 'nd', '3' => 'rd'][(string)($day % 10)] ?? 'th');
    return $d->format('l ') . $day . $suffix . $d->format(' F Y');
}
/** "11:00" + "11:45" → "11:00–11:45", tolerating a missing end. */
function time_label(string $start, string $end): string {
    if ($start === '' || $end === '') return $start . $end;
    return $start . '–' . $end;
}
