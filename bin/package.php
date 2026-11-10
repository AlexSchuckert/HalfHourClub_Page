<?php
declare(strict_types=1);
// Build an uploadable release ZIP under storage/releases/. It includes the
// installed Composer libraries, so the host never runs Composer, and leaves out
// configuration, uploaded media, backups, keys and tests.
if (PHP_SAPI !== 'cli') exit(1);
$root = dirname(__DIR__);
if (!is_file("$root/vendor/autoload.php")) { fwrite(STDERR, "Run composer install --no-dev first.\n"); exit(1); }
$dir = "$root/storage/releases"; if (!is_dir($dir)) mkdir($dir, 0700, true);
$target = "$dir/halfhourclubs-" . gmdate('Ymd-His') . '.zip';
$zip = new ZipArchive(); $zip->open($target, ZipArchive::CREATE | ZipArchive::EXCL);
foreach (['app', 'views', 'public', 'database', 'bin', 'vendor', 'docs'] as $directory) {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator("$root/$directory", FilesystemIterator::SKIP_DOTS));
    foreach ($files as $file) {
        if (!$file->isFile() || $file->isLink()) continue;
        $path = substr($file->getPathname(), strlen($root) + 1);
        if (str_contains($path, '/.git/') || str_ends_with($path, '.DS_Store')) continue;
        $zip->addFile($file->getPathname(), $path);
    }
}
foreach (['README.md', 'config.example.php', 'composer.json', 'composer.lock'] as $file) $zip->addFile("$root/$file", $file);
$zip->addEmptyDir('storage');
$zip->close();
echo "$target\n";
