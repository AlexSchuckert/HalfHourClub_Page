<?php
declare(strict_types=1);

const ROOT = __DIR__ . '/..';
umask(0077);
$configFile = getenv('HHC_CONFIG') ?: ROOT . '/config.local.php';
if (!is_file($configFile)) {
    throw new RuntimeException('Copy config.example.php to config.local.php and configure it.');
}
ob_start();
$GLOBALS['config'] = require $configFile;
if (ob_get_clean() !== '') {
    // Text before <?php in the config would be sent ahead of every page and API reply.
    throw new RuntimeException("$configFile has something before <?php on its first line (or after the closing ]; ). Remove it.");
}
if (is_file(ROOT . '/vendor/autoload.php')) require ROOT . '/vendor/autoload.php';
foreach (['Database', 'Support', 'Auth', 'Clubs', 'Media', 'Markdown'] as $module) require_once __DIR__ . '/' . $module . '.php';
if (!preg_match('/^[a-f0-9]{64}$/D', (string)config('secret'))) {
    throw new RuntimeException("Set 'secret' in the config to 64 hexadecimal characters.");
}
if (config('env') === 'production' && !str_starts_with((string)config('url'), 'https://')) {
    throw new RuntimeException('Production requires an HTTPS url.');
}
if (PHP_SAPI !== 'cli') {
    ini_set('display_errors', '0');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex, nofollow');
    // 'unsafe-inline' styles: the markdown editor positions its text layers with
    // inline styles. 'wasm-unsafe-eval': the HEIC decoder is WebAssembly. blob:
    // workers and media: the in-browser video compressor and its previews.
    header("Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self' blob: data:; worker-src 'self' blob:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (config('env') === 'production') header('Strict-Transport-Security: max-age=31536000');
}
