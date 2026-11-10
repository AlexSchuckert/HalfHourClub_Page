<?php
declare(strict_types=1);
function config(string $key, mixed $default = null): mixed { return $GLOBALS['config'][$key] ?? $default; }
function db(): PDO {
    static $pdo;
    if (!$pdo) {
        $pdo = new PDO(config('dsn'), config('db_user'), config('db_password'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}
function query(string $sql, array $params = []): PDOStatement { $q = db()->prepare($sql); $q->execute($params); return $q; }
function rows(string $sql, array $params = []): array { return query($sql, $params)->fetchAll(); }
function one(string $sql, array $params = []): ?array { return query($sql, $params)->fetch() ?: null; }
function atomic(callable $fn): mixed {
    db()->beginTransaction();
    try { $result = $fn(); db()->commit(); return $result; }
    catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
}
function new_id(): string { return bin2hex(random_bytes(16)); }
function install_schema(): void {
    foreach (explode(';', file_get_contents(ROOT . '/database/schema.sql')) as $sql) {
        $sql = trim(preg_replace('/^--.*$/m', '', $sql));
        if ($sql !== '') db()->exec($sql);
    }
}
function setting(string $name): ?string { return one('SELECT value FROM settings WHERE name = ?', [$name])['value'] ?? null; }
function set_setting(string $name, string $value): void {
    query('INSERT INTO settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)', [$name, $value]);
}
