<?php
declare(strict_types=1);
/*
 * One-off import from the old HalfHourClub_Content repository: folders of
 * markdown with front matter, plus media/ beside them. Slugs are the folder
 * names, so club addresses stay the same.
 */

/** The small YAML subset the old site wrote: scalars, 'quoted', "quoted" and [inline, lists]. */
function yaml_scalar(string $v): string|array {
    $v = trim($v);
    if ($v !== '' && $v[0] === '[' && str_ends_with($v, ']')) {
        $inner = trim(substr($v, 1, -1));
        return $inner === '' ? [] : array_map(fn($x) => (string)yaml_scalar($x), str_getcsv($inner, ',', "'", "\\"));
    }
    if (strlen($v) >= 2 && $v[0] === "'" && str_ends_with($v, "'")) return str_replace("''", "'", substr($v, 1, -1));
    if (strlen($v) >= 2 && $v[0] === '"' && str_ends_with($v, '"')) return stripcslashes(substr($v, 1, -1));
    return $v;
}

function front_matter(string $text): array {
    $text = str_replace("\r\n", "\n", $text);
    if (!preg_match('/^---\n(.*?)\n---\n?(.*)$/s', $text, $m)) return [[], $text];
    $data = [];
    foreach (explode("\n", $m[1]) as $line) {
        if (preg_match('/^([A-Za-z_][\w-]*):\s*(.*)$/', $line, $kv)) $data[$kv[1]] = yaml_scalar($kv[2]);
    }
    return [$data, $m[2]];
}

/** categories.yml / contributors.yml: a list of `- name: …` maps. */
function yaml_list(string $file): array {
    if (!is_file($file)) return [];
    $items = [];
    foreach (explode("\n", str_replace("\r\n", "\n", file_get_contents($file))) as $line) {
        if (preg_match('/^\s*#/', $line) || trim($line) === '') continue;
        if (preg_match('/^-\s+([A-Za-z_]\w*):\s*(.*)$/', $line, $m)) { $items[] = [$m[1] => yaml_scalar($m[2])]; continue; }
        if ($items && preg_match('/^\s+([A-Za-z_]\w*):\s*(.*)$/', $line, $m)) $items[count($items) - 1][$m[1]] = yaml_scalar($m[2]);
    }
    return $items;
}

function import_content(string $dir, callable $log): array {
    $dir = rtrim($dir, '/');
    if (!is_dir("$dir/clubs")) throw new RuntimeException("$dir has no clubs/ folder.");
    if (one('SELECT 1 FROM clubs LIMIT 1')) throw new RuntimeException('The database already has clubs. Import into an empty, freshly installed database.');

    $aliases = [];
    foreach (yaml_list("$dir/contributors.yml") as $i => $p) {
        if (!isset($p['name'])) continue;
        query('INSERT IGNORE INTO people (name, position) VALUES (?, ?)', [$p['name'], $i]);
        foreach ((array)($p['also'] ?? []) as $alias) $aliases[mb_strtolower($alias)] = $p['name'];
    }
    foreach (yaml_list("$dir/categories.yml") as $i => $c) {
        if (isset($c['name'])) query('INSERT IGNORE INTO categories (name, colour, position) VALUES (?, ?, ?)', [$c['name'], in_array($c['colour'] ?? '', COLOUR_ROTATION, true) ? $c['colour'] : 'plain', $i]);
    }

    $counts = ['clubs' => 0, 'contributions' => 0, 'media' => 0];
    $folders = glob("$dir/clubs/*", GLOB_ONLYDIR) ?: [];
    sort($folders);
    $newCategories = [];
    foreach ($folders as $folder) {
        $slug = basename($folder);
        if (!is_file("$folder/club.md")) { $log("skip $slug: no club.md"); continue; }
        [$meta, $prompt] = front_matter(file_get_contents("$folder/club.md"));
        $contributions = [];
        $files = glob("$folder/contributions/*.md") ?: [];
        usort($files, fn($a, $b) => strnatcmp(basename($a), basename($b)));
        foreach ($files as $file) {
            [$c, $body] = front_matter(file_get_contents($file));
            $names = array_map(fn($n) => $aliases[mb_strtolower(trim($n))] ?? trim($n), (array)($c['contributors'] ?? $c['contributor'] ?? ['Anonymous']));
            $category = trim((string)($c['category'] ?? '')) ?: 'Other';
            $contributions[] = ['people' => array_values(array_filter($names)), 'category' => $category, 'body' => trim($body)];
            if (!one('SELECT 1 FROM categories WHERE name = ?', [$category])) $newCategories[mb_strtolower($category)] = $category;
        }
        $date = preg_match('/^(\d{4}-\d{2}-\d{2})/', $slug, $d) ? $d[1] : (string)($meta['date'] ?? '');

        atomic(function () use ($folder, $slug, $meta, $prompt, $contributions, $date, &$counts, $log) {
            $id = new_id();
            query('INSERT INTO clubs (id, slug, title, location, date, start_time, end_time, prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$id, $slug, (string)($meta['title'] ?? $slug), (string)($meta['location'] ?? ''), $date, (string)($meta['start'] ?? ''), (string)($meta['end'] ?? ''), trim($prompt), "$date 12:00:00", "$date 12:00:00"]);
            foreach ($contributions as $position => $c) {
                $cid = new_id();
                query('INSERT INTO contributions (id, club_id, position, category, body) VALUES (?, ?, ?, ?, ?)', [$cid, $id, $position, $c['category'], $c['body']]);
                foreach ($c['people'] as $p => $name) query('INSERT INTO contribution_people (contribution_id, position, name) VALUES (?, ?, ?)', [$cid, $p, $name]);
                $counts['contributions']++;
            }
            foreach (glob("$folder/media/*") ?: [] as $file) {
                $name = strtolower(basename($file));
                $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file);
                if (!isset(MEDIA_TYPES[$mime]) || !preg_match('/^[a-f0-9]{8,32}\.[a-z0-9]{2,5}$/D', $name)) { $log("skip $slug/media/$name: unsupported"); continue; }
                if (one('SELECT 1 FROM media WHERE name = ?', [$name])) throw new RuntimeException("Two clubs share the file name $name.");
                $sha = hash_file('sha256', $file);
                $target = media_dir('media') . '/' . $sha;
                if (!is_file($target) && !copy($file, $target)) throw new RuntimeException("Could not copy $file");
                query('INSERT INTO media (name, sha256, mime, size, club_id) VALUES (?, ?, ?, ?, ?)', [$name, $sha, $mime, filesize($file), $id]);
                $counts['media']++;
            }
            $counts['clubs']++;
            $log("imported $slug");
        });
    }
    // Categories nobody configured get the old site's colours: the rotation,
    // skipping configured colours, in alphabetical order.
    ksort($newCategories);
    foreach ($newCategories as $name) add_category($name);
    return $counts;
}
