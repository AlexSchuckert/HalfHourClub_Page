<?php
declare(strict_types=1);

/** Pastel names; theme.css maps each to a colour. New categories take the first unused one. */
const COLOUR_ROTATION = ['rose', 'sage', 'blue', 'lavender', 'honey', 'clay', 'mint'];
const MEDIA_REFERENCE = '~(?<![\w/])media/([a-f0-9]{8,32}\.[a-z0-9]{2,5})~';

function club_url(array $club): string { return '/clubs/' . $club['slug'] . '/'; }
function category_url(string $name): string { return '/categories/' . slugify($name) . '/'; }
function contributor_url(string $name): string { return '/contributors/' . slugify($name) . '/'; }

/** "Ella" · "Ella & Alex" · "Ella, Alex & Mira" */
function people_label(array $names): string {
    if (count($names) <= 1) return $names[0] ?? 'Anonymous';
    return implode(', ', array_slice($names, 0, -1)) . ' & ' . end($names);
}

/** Every live club, newest first, each with its contributions' people and categories (no bodies). */
function club_cards(?string $where = null, array $params = []): array {
    $clubs = rows('SELECT id, slug, title, location, date, start_time, end_time, prompt FROM clubs WHERE deleted_at IS NULL'
        . ($where ? " AND $where" : '') . ' ORDER BY date DESC, title', $params);
    if (!$clubs) return [];
    $byId = [];
    foreach ($clubs as $c) { $c['contributions'] = []; $byId[$c['id']] = $c; }
    $marks = implode(',', array_fill(0, count($byId), '?'));
    $contributions = rows("SELECT id, club_id, category FROM contributions WHERE club_id IN ($marks) ORDER BY club_id, position", array_keys($byId));
    $people = [];
    if ($contributions) {
        $cmarks = implode(',', array_fill(0, count($contributions), '?'));
        foreach (rows("SELECT contribution_id, name FROM contribution_people WHERE contribution_id IN ($cmarks) ORDER BY contribution_id, position", array_column($contributions, 'id')) as $p) {
            $people[$p['contribution_id']][] = $p['name'];
        }
    }
    foreach ($contributions as $c) {
        $c['people'] = $people[$c['id']] ?? [];
        $byId[$c['club_id']]['contributions'][] = $c;
    }
    return array_values($byId);
}

function colours(): array { return array_column(rows('SELECT name, colour FROM categories'), 'colour', 'name'); }
function colour_of(string $category, array $colours): string {
    foreach ($colours as $name => $colour) if (mb_strtolower($name) === mb_strtolower($category)) return $colour;
    return 'plain';
}

/** A club with full contributions, or null. Follows renamed addresses. */
function find_club(string $slug): ?array {
    $club = one('SELECT * FROM clubs WHERE slug = ? AND deleted_at IS NULL', [$slug]);
    if (!$club) {
        $moved = one('SELECT c.slug FROM slug_redirects r JOIN clubs c ON c.id = r.club_id WHERE r.slug = ? AND c.deleted_at IS NULL', [$slug]);
        if ($moved) redirect('/clubs/' . $moved['slug'] . '/' . (str_ends_with(parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '', '/edit/') ? 'edit/' : ''), 301);
        return null;
    }
    $club['contributions'] = rows('SELECT id, category, body FROM contributions WHERE club_id = ? ORDER BY position', [$club['id']]);
    foreach ($club['contributions'] as &$c) {
        $c['people'] = array_column(rows('SELECT name FROM contribution_people WHERE contribution_id = ? ORDER BY position', [$c['id']]), 'name');
    }
    return $club;
}

/** Categories in use, in configured order, with how many clubs and contributions each has. */
function category_index(): array {
    return rows('SELECT k.name, k.colour, COUNT(DISTINCT c.club_id) clubs, COUNT(*) contributions
        FROM contributions c JOIN clubs cl ON cl.id = c.club_id AND cl.deleted_at IS NULL
        JOIN categories k ON k.name = c.category
        GROUP BY k.name, k.colour, k.position ORDER BY k.position, k.name');
}

function contributor_index(): array {
    return rows('SELECT p.name, COUNT(DISTINCT c.club_id) clubs, COUNT(*) contributions, COALESCE(MIN(pe.position), 1000) sort
        FROM contribution_people p JOIN contributions c ON c.id = p.contribution_id
        JOIN clubs cl ON cl.id = c.club_id AND cl.deleted_at IS NULL
        LEFT JOIN people pe ON pe.name = p.name
        GROUP BY p.name ORDER BY sort, p.name');
}

function calendar_days(): array {
    $days = [];
    foreach (rows('SELECT slug, title, date FROM clubs WHERE deleted_at IS NULL ORDER BY date, title') as $c) {
        $days[$c['date']][] = ['title' => $c['title'], 'url' => club_url($c)];
    }
    return $days;
}

/** Names for the form's dropdown and quick-add buttons: configured ones first, then anything used. */
function form_choices(): array {
    $categories = array_column(rows('SELECT name FROM categories ORDER BY position, name'), 'name');
    $people = array_column(rows('SELECT name FROM people ORDER BY position, name'), 'name');
    foreach (rows('SELECT DISTINCT name FROM contribution_people ORDER BY name') as $p) {
        if (!in_array(mb_strtolower($p['name']), array_map('mb_strtolower', $people), true)) $people[] = $p['name'];
    }
    return ['categories' => $categories, 'contributors' => $people];
}

/** Use the existing spelling when someone types "poem" for "Poem". */
function canonical(string $value, array $known): string {
    foreach ($known as $k) if (mb_strtolower($k) === mb_strtolower($value)) return $k;
    return $value;
}

function clean_text(mixed $value, int $max, string $label, bool $required = false): string {
    if (!is_string($value)) $value = '';
    $value = trim(str_replace("\r\n", "\n", $value));
    if ($required && $value === '') throw new InvalidArgumentException("$label is missing.");
    if (mb_strlen($value) > $max) throw new InvalidArgumentException("$label is too long.");
    return $value;
}

/** Validate a submitted club. Returns clean fields plus contributions. */
function read_club(array $in): array {
    $club = [
        'title' => clean_text($in['title'] ?? '', 255, 'The name', true),
        'location' => clean_text($in['location'] ?? '', 255, 'The location'),
        'date' => clean_text($in['date'] ?? '', 10, 'The date', true),
        'start_time' => clean_text($in['start'] ?? '', 5, 'The start time'),
        'end_time' => clean_text($in['end'] ?? '', 5, 'The end time'),
        'prompt' => clean_text($in['prompt'] ?? '', 20000, 'The prompt'),
    ];
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $club['date']);
    if (!$d || $d->format('Y-m-d') !== $club['date']) throw new InvalidArgumentException('The date is not valid.');
    foreach (['start_time', 'end_time'] as $t) {
        if ($club[$t] !== '' && !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $club[$t])) throw new InvalidArgumentException('Times must look like 11:30.');
    }
    $list = $in['contributions'] ?? null;
    if (!is_array($list) || !$list) throw new InvalidArgumentException('Add at least one contribution.');
    if (count($list) > 100) throw new InvalidArgumentException('That is a lot of contributions — 100 at most.');
    $club['contributions'] = [];
    foreach ($list as $i => $c) {
        if (!is_array($c)) throw new InvalidArgumentException('A contribution could not be read.');
        $names = [];
        foreach ((array)($c['contributors'] ?? []) as $n) {
            $n = clean_text($n, 100, 'A name');
            if ($n !== '' && !in_array(mb_strtolower($n), array_map('mb_strtolower', $names), true)) $names[] = $n;
        }
        if (!$names) throw new InvalidArgumentException('Contribution ' . ($i + 1) . ' needs a name.');
        if (count($names) > 20) throw new InvalidArgumentException('Twenty names per contribution at most.');
        $club['contributions'][] = [
            'people' => $names,
            'category' => clean_text($c['category'] ?? '', 100, 'A category') ?: 'Other',
            'body' => clean_text($c['body'] ?? '', 200000, 'Contribution ' . ($i + 1), true),
        ];
    }
    return $club;
}

function unique_slug(string $base, ?string $clubId): string {
    for ($n = 1; ; $n++) {
        $slug = $n === 1 ? $base : "$base-$n";
        $taken = one('SELECT id FROM clubs WHERE slug = ?', [$slug]);
        $redirect = one('SELECT club_id FROM slug_redirects WHERE slug = ?', [$slug]);
        if ((!$taken || $taken['id'] === $clubId) && (!$redirect || $redirect['club_id'] === $clubId)) return $slug;
    }
}

function referenced_media(array $club): array {
    $text = $club['prompt'] . "\n" . implode("\n", array_column($club['contributions'], 'body'));
    preg_match_all(MEDIA_REFERENCE, $text, $m);
    return array_values(array_unique($m[1]));
}

/**
 * Create (id null) or update a club in one transaction. Updates must carry the
 * revision the editor started from; if someone else saved in between, this
 * refuses rather than silently overwriting their changes.
 */
function save_club(?string $id, array $club, int $revision = 0): array {
    return atomic(function () use ($id, $club, $revision) {
        $existing = $id ? one('SELECT * FROM clubs WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [$id]) : null;
        if ($id && !$existing) throw new HttpError(404, 'That club no longer exists.');
        if ($existing && (int)$existing['revision'] !== $revision) {
            throw new HttpError(409, 'Someone else saved this club while you were editing. Reload to see their changes, then make yours again.');
        }
        $id ??= new_id();
        $slug = unique_slug($club['date'] . '-' . (slugify($club['title']) ?: 'club'), $existing ? $id : null);
        $fields = [$slug, $club['title'], $club['location'], $club['date'], $club['start_time'], $club['end_time'], $club['prompt']];
        if ($existing) {
            query('UPDATE clubs SET slug = ?, title = ?, location = ?, date = ?, start_time = ?, end_time = ?, prompt = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?', [...$fields, $id]);
            if ($existing['slug'] !== $slug) {
                query('INSERT INTO slug_redirects (slug, club_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE club_id = VALUES(club_id)', [$existing['slug'], $id]);
                query('DELETE FROM slug_redirects WHERE slug = ?', [$slug]);
            }
            query('DELETE FROM contributions WHERE club_id = ?', [$id]);
        } else {
            query('INSERT INTO clubs (slug, title, location, date, start_time, end_time, prompt, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [...$fields, $id]);
        }

        $categories = array_column(rows('SELECT name FROM categories'), 'name');
        $people = array_merge(array_column(rows('SELECT name FROM people'), 'name'), array_column(rows('SELECT DISTINCT name FROM contribution_people'), 'name'));
        foreach ($club['contributions'] as $position => $c) {
            $category = canonical($c['category'], $categories);
            if (!in_array($category, $categories, true)) { add_category($category); $categories[] = $category; }
            $cid = new_id();
            query('INSERT INTO contributions (id, club_id, position, category, body) VALUES (?, ?, ?, ?, ?)', [$cid, $id, $position, $category, $c['body']]);
            foreach ($c['people'] as $p => $name) query('INSERT INTO contribution_people (contribution_id, position, name) VALUES (?, ?, ?)', [$cid, $p, canonical($name, $people)]);
        }

        // Attach the files this club now refers to; release any it no longer does.
        $names = referenced_media($club);
        foreach ($names as $name) {
            $m = one('SELECT club_id FROM media WHERE name = ? FOR UPDATE', [$name]);
            if (!$m) throw new InvalidArgumentException("A photo or video ($name) is missing. Remove it and add it again.");
            if ($m['club_id'] !== null && $m['club_id'] !== $id) throw new InvalidArgumentException("A file ($name) belongs to another club.");
            query('UPDATE media SET club_id = ? WHERE name = ?', [$id, $name]);
        }
        $marks = $names ? ' AND name NOT IN (' . implode(',', array_fill(0, count($names), '?')) . ')' : '';
        query('UPDATE media SET club_id = NULL, created_at = UTC_TIMESTAMP() WHERE club_id = ?' . $marks, [$id, ...$names]);

        return one('SELECT * FROM clubs WHERE id = ?', [$id]);
    });
}

function add_category(string $name): void {
    $used = array_column(rows('SELECT colour FROM categories'), 'colour');
    $free = array_values(array_diff(COLOUR_ROTATION, $used));
    $colour = $free[0] ?? COLOUR_ROTATION[count($used) % count(COLOUR_ROTATION)];
    query('INSERT IGNORE INTO categories (name, colour, position) VALUES (?, ?, 1000)', [$name, $colour]);
}

/** Deleting hides a club; `php bin/console.php undelete <slug>` brings it back. */
function delete_club(string $id, int $revision): void {
    atomic(function () use ($id, $revision) {
        $club = one('SELECT * FROM clubs WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [$id]);
        if (!$club) throw new HttpError(404, 'That club no longer exists.');
        if ((int)$club['revision'] !== $revision) throw new HttpError(409, 'Someone else changed this club. Reload before deleting it.');
        query('UPDATE clubs SET deleted_at = UTC_TIMESTAMP(), revision = revision + 1 WHERE id = ?', [$id]);
    });
}
