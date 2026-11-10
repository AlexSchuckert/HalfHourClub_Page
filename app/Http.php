<?php
declare(strict_types=1);

function dispatch(): void {
    $method = $_SERVER['REQUEST_METHOD'];
    $path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
    if (!in_array($method, ['GET', 'HEAD', 'POST'], true)) throw new HttpError(405, 'Method not allowed.');
    $post = $method === 'POST';
    if ($post) check_origin();

    // --- Open to everyone -------------------------------------------------
    if ($path === '/health/') { query('SELECT 1'); header('Content-Type: text/plain'); header('Cache-Control: no-store'); echo 'ok'; return; }
    if ($path === '/robots.txt') { header('Content-Type: text/plain'); echo "User-agent: *\nDisallow: /\n"; return; }
    if ($path === '/login/') { login_page($post); return; }

    // --- Everything else needs the family password ------------------------
    if (!signed_in()) {
        if (str_starts_with($path, '/api/') || str_starts_with($path, '/media/')) throw new HttpError(401, 'Please sign in again.');
        redirect('/login/?next=' . rawurlencode($_SERVER['REQUEST_URI']));
    }
    if ($post) check_csrf();

    if ($path === '/logout/' && $post) { sign_out(); redirect('/login/'); }

    if (preg_match('~^/media/([a-f0-9]{8,32}\.[a-z0-9]{2,5})$~D', $path, $m)) {
        serve_media($m[1], ($_GET['size'] ?? '') === 'display'); return;
    }

    if ($path === '/') {
        render('home', ['cards' => array_slice(club_cards(), 0, 8), 'clubCount' => (int)one('SELECT COUNT(*) n FROM clubs WHERE deleted_at IS NULL')['n'],
            'categories' => category_index(), 'contributors' => contributor_index(), 'days' => calendar_days(), 'colours' => colours()]);
        return;
    }
    if ($path === '/new/') { render('edit', ['pageTitle' => 'New half hour club', 'club' => null, 'choices' => form_choices(), 'hideNew' => true]); return; }

    if (preg_match('~^/clubs/([a-z0-9-]{1,190})/(edit/)?$~D', $path, $m)) {
        $club = find_club($m[1]);
        if (!$club) throw new HttpError(404, 'There is no club at this address.');
        if (!empty($m[2])) { render('edit', ['pageTitle' => 'Edit ' . $club['title'], 'club' => $club, 'choices' => form_choices(), 'hideNew' => true]); return; }
        render('club', ['pageTitle' => $club['title'], 'club' => $club, 'colours' => colours()]);
        return;
    }
    if (preg_match('~^/(categories|contributors)/([a-z0-9-]{1,120})/$~D', $path, $m)) { list_page($m[1], $m[2]); return; }

    // --- The form's API ----------------------------------------------------
    if ($post && $path === '/api/media') {
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) throw new HttpError(413, 'That file is larger than the server accepts.');
        if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) throw new HttpError(400, 'The upload did not arrive in one piece. Try again.');
        try { json_response(store_media($f['tmp_name'])); } catch (InvalidArgumentException $e) { throw new HttpError(422, $e->getMessage()); }
        return;
    }
    if ($post && preg_match('~^/api/clubs(?:/([a-f0-9]{32}))?$~D', $path, $m)) {
        $in = request_json();
        try { $club = save_club($m[1] ?? null, read_club($in), (int)($in['revision'] ?? 0)); }
        catch (InvalidArgumentException $e) { throw new HttpError(422, $e->getMessage()); }
        json_response(['url' => club_url($club), 'revision' => (int)$club['revision']]);
        return;
    }
    if ($post && preg_match('~^/api/clubs/([a-f0-9]{32})/delete$~D', $path, $m)) {
        delete_club($m[1], (int)(request_json()['revision'] ?? -1));
        json_response(['url' => '/']);
        return;
    }
    if ($post && $path === '/api/geocode') { json_response(geocode(request_json())); return; }

    throw new HttpError(404, 'There is nothing at this address.');
}

function login_page(bool $post): void {
    $next = $_GET['next'] ?? '/';
    if (!is_string($next) || !safe_path($next) || str_starts_with($next, '/login/')) $next = '/';
    if (!$post && signed_in()) redirect($next);
    $error = '';
    if ($post) {
        if (attempt_sign_in((string)($_POST['password'] ?? ''))) redirect($next);
        $error = "That's not the password — try again.";
    }
    render('login', ['pageTitle' => 'Sign in', 'error' => $error, 'next' => $next, 'bare' => true]);
}

function list_page(string $kind, string $slug): void {
    if ($kind === 'categories') {
        $entry = null;
        foreach (category_index() as $c) if (slugify($c['name']) === $slug) $entry = $c;
        if (!$entry) throw new HttpError(404, 'There is no such category.');
        $cards = club_cards('id IN (SELECT club_id FROM contributions WHERE category = ?)', [$entry['name']]);
    } else {
        $entry = null;
        foreach (contributor_index() as $c) if (slugify($c['name']) === $slug) $entry = $c;
        if (!$entry) throw new HttpError(404, 'There is no such contributor.');
        $cards = club_cards('id IN (SELECT c.club_id FROM contributions c JOIN contribution_people p ON p.contribution_id = c.id WHERE p.name = ?)', [$entry['name']]);
    }
    render('list', ['pageTitle' => $entry['name'], 'kind' => $kind === 'categories' ? 'Category' : 'Contributor', 'entry' => $entry, 'cards' => $cards, 'colours' => colours()]);
}

/**
 * Coordinates → "Kardamyli, Messenia", via OpenStreetMap. Proxied so we can send
 * the identifying User-Agent Nominatim's usage policy asks for (browsers can't),
 * and only a coarse place label ever comes back. Nothing is logged.
 */
function geocode(array $in): array {
    rate_limit('geocode', 60, 3600);
    $lat = $in['latitude'] ?? null; $lon = $in['longitude'] ?? null;
    if (!is_numeric($lat) || !is_numeric($lon) || abs((float)$lat) > 90 || abs((float)$lon) > 180) throw new HttpError(400, 'Those are not coordinates.');
    // %F, not %f: never a locale's decimal comma.
    $url = 'https://nominatim.openstreetmap.org/reverse?' . http_build_query(['format' => 'jsonv2', 'lat' => sprintf('%.5F', $lat), 'lon' => sprintf('%.5F', $lon), 'zoom' => 14, 'addressdetails' => 1]);
    $curl = curl_init($url);
    // Nominatim's usage policy asks for a User-Agent and Referer that identify the site.
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_USERAGENT => 'HalfHourClubs/1.0 (private family archive; ' . config('url') . ')',
        CURLOPT_REFERER => config('url') . '/', CURLOPT_HTTPHEADER => ['Accept-Language: en']]);
    $body = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    return ['location' => place_label($status, $body === false ? curl_error($curl) : $body)];
}

/** The settlement, then the region: "Kardamyli, Messenia", never a street address. */
function place_label(int $status, string $body): string {
    $reply = json_decode($body, true);
    if ($status !== 200 || !is_array($reply) || !isset($reply['address'])) {
        error_log('Half Hour Clubs geocode: HTTP ' . $status . ' ' . substr(preg_replace('/\s+/', ' ', $body), 0, 200));
        $reason = is_array($reply) && is_string($reply['error'] ?? null) ? $reply['error'] : ($status ? "HTTP $status" : 'no connection');
        throw new HttpError(502, "OpenStreetMap could not name this place ($reason). Type it in instead.");
    }
    $a = $reply['address'];
    $place = $a['village'] ?? $a['hamlet'] ?? $a['town'] ?? $a['suburb'] ?? $a['city'] ?? $a['municipality'] ?? null;
    $region = $a['county'] ?? $a['state_district'] ?? $a['state'] ?? null;
    return implode(', ', array_filter([$place, $place && $region !== $place ? $region : null])) ?: (string)($a['country'] ?? '');
}
