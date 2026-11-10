<?php
declare(strict_types=1);
/*
 * One shared family password. Signing in sets a cookie that lasts a year, so
 * each device asks once.
 *
 * Deliberately not PHP sessions: shared hosting garbage-collects session files
 * after ~24 minutes by default, which would quietly turn "enter the password
 * once" into "enter it every morning". The cookie is self-contained instead:
 *
 *     <expires>.<password fingerprint>.<HMAC of both>
 *
 * The fingerprint is derived from the stored password hash, so changing the
 * family password (`php bin/console.php password`) signs every device out at
 * once. Changing `secret` in the config does the same.
 */

const AUTH_COOKIE = 'hhc_auth';
const AUTH_LIFETIME = 365 * 86400;

function password_fingerprint(): string {
    $hash = setting('password_hash');
    if ($hash === null) throw new HttpError(503, 'No family password is set yet. Run: php bin/console.php password');
    return substr(hash('sha256', $hash), 0, 16);
}
function auth_mac(string $payload): string { return hash_hmac('sha256', 'auth|' . $payload, hex2bin(config('secret'))); }

function signed_in(): bool {
    $cookie = $_COOKIE[AUTH_COOKIE] ?? '';
    if (!is_string($cookie) || !preg_match('/^(\d{10})\.([a-f0-9]{16})\.([a-f0-9]{64})$/D', $cookie, $m)) return false;
    if ((int)$m[1] < time()) return false;
    if (!hash_equals(auth_mac($m[1] . '.' . $m[2]), $m[3])) return false;
    return hash_equals(password_fingerprint(), $m[2]);
}

function issue_auth_cookie(): void {
    $payload = (time() + AUTH_LIFETIME) . '.' . password_fingerprint();
    $value = $payload . '.' . auth_mac($payload);
    if (!headers_sent()) setcookie(AUTH_COOKIE, $value, ['expires' => time() + AUTH_LIFETIME, 'path' => '/', 'secure' => config('env') === 'production', 'httponly' => true, 'samesite' => 'Lax']);
    $_COOKIE[AUTH_COOKIE] = $value;
}

function sign_out(): void {
    setcookie(AUTH_COOKIE, '', ['expires' => 1, 'path' => '/', 'secure' => config('env') === 'production', 'httponly' => true, 'samesite' => 'Lax']);
    unset($_COOKIE[AUTH_COOKIE]);
}

/** Token for state-changing requests, bound to this device's sign-in cookie. */
function csrf(): string { return hash_hmac('sha256', 'csrf|' . ($_COOKIE[AUTH_COOKIE] ?? ''), hex2bin(config('secret'))); }

function check_csrf(): void {
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? '');
    if (!is_string($token) || !hash_equals(csrf(), $token)) throw new HttpError(403, 'This page has expired. Reload it and try again.');
}

/** Belt and braces on top of SameSite: a browser POST from another site is refused outright. */
function check_origin(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '' || $origin === 'null') return; // same-origin form posts may omit it
    $expected = parse_url((string)config('url'));
    $actual = parse_url($origin);
    if (($actual['host'] ?? '') !== ($expected['host'] ?? '') && ($actual['host'] ?? '') !== ($_SERVER['HTTP_HOST'] ?? '')) {
        throw new HttpError(403, 'Cross-site request refused.');
    }
}

function rate_limit(string $scope, int $limit, int $seconds = 900): void {
    $key = hash('sha256', $scope . ':' . ($_SERVER['REMOTE_ADDR'] ?? 'cli'));
    atomic(function () use ($key, $limit, $seconds) {
        query('INSERT IGNORE INTO rate_limits (bucket, hits, expires_at) VALUES (?, 0, ?)', [$key, time() + $seconds]);
        $r = one('SELECT * FROM rate_limits WHERE bucket = ? FOR UPDATE', [$key]);
        if ((int)$r['expires_at'] < time()) { $r['hits'] = 0; query('UPDATE rate_limits SET hits = 0, expires_at = ? WHERE bucket = ?', [time() + $seconds, $key]); }
        if ((int)$r['hits'] >= $limit) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
        query('UPDATE rate_limits SET hits = hits + 1 WHERE bucket = ?', [$key]);
    });
}

function attempt_sign_in(string $password): bool {
    rate_limit('sign-in', 10);
    $hash = setting('password_hash');
    // A fixed-cost comparison even before a password exists.
    $ok = password_verify($password, $hash ?? '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.');
    if (!$ok || $hash === null) return false;
    if (password_needs_rehash($hash, PASSWORD_DEFAULT)) set_setting('password_hash', password_hash($password, PASSWORD_DEFAULT));
    issue_auth_cookie();
    return true;
}

function set_family_password(string $password): void {
    if (mb_strlen($password) < 8 || strlen($password) > 72 || str_contains($password, "\0")) {
        throw new InvalidArgumentException('Use at least 8 characters (72 bytes at most).');
    }
    set_setting('password_hash', password_hash($password, PASSWORD_DEFAULT));
}
