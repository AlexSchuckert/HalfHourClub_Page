<?php
// Copy to config.local.php, outside the public document root. Never commit it.
return [
    'env' => 'local', // 'production' requires an https:// url
    'url' => 'http://127.0.0.1:8000',
    'dsn' => 'mysql:host=127.0.0.1;port=3306;dbname=hhc;charset=utf8mb4',
    'db_user' => 'hhc',
    'db_password' => '',
    // Private directory for photos, videos, display copies and backups.
    // Must NOT be inside public/.
    'storage' => __DIR__ . '/storage',
    // 64 hexadecimal characters. Signs the sign-in cookie and form tokens.
    // Generate once with: php -r 'echo bin2hex(random_bytes(32)), "\n";'
    // Changing it signs everyone out.
    'secret' => '',
];
