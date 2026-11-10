<?php
declare(strict_types=1);
try {
    require __DIR__ . '/../app/bootstrap.php';
    require ROOT . '/app/Http.php';
    dispatch();
} catch (HttpError $e) {
    $api = preg_match('~^/(api|media)/~', $_SERVER['REQUEST_URI'] ?? '');
    if ($api) json_response(['error' => $e->getMessage()], $e->status);
    else render('message', ['pageTitle' => 'Half Hour Clubs', 'message' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('Half Hour Clubs failure: ' . get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
    http_response_code(500);
    echo '<!doctype html><html lang="en"><meta charset="utf-8"><title>Half Hour Clubs</title><p>Something went wrong. Try again in a moment.</p></html>';
}
