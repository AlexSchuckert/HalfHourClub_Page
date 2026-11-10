<?php
/** @var string $content */
$signedIn = false; try { $signedIn = signed_in(); } catch (Throwable) {}
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title><?= isset($pageTitle) && $pageTitle !== 'Half Hour Clubs' ? h($pageTitle) . ' — ' : '' ?>Half Hour Clubs</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#fcf9f4" />
  <link rel="preload" href="/assets/fonts/eb-garamond-400.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="/assets/fonts/fraunces-700.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="<?= asset('/assets/theme.css') ?>" />
  <?php foreach ($pageStyles ?? [] as $href): ?><link rel="stylesheet" href="<?= asset($href) ?>" />
  <?php endforeach ?>
</head>
<body class="<?= !empty($bare) ? 'body--bare' : '' ?>">
  <div class="shell">
    <?php if (empty($bare)): ?>
    <header class="masthead">
      <h1 class="masthead__title"><a href="/">Half Hour Clubs</a></h1>
      <?php if ($signedIn): ?>
      <nav class="masthead__actions">
        <?php if (!empty($editUrl)): ?><a class="button" href="<?= h($editUrl) ?>">Edit</a><?php endif ?>
        <?php if (empty($hideNew)): ?><a class="button button--primary" href="/new/">＋ New half hour club</a><?php endif ?>
      </nav>
      <?php endif ?>
    </header>
    <?php endif ?>

    <main><?= $content ?></main>

    <?php if (empty($bare) && $signedIn): ?>
    <footer class="footer">
      <span><a href="/">Calendar</a></span>
      <form method="post" action="/logout/" class="footer__signout">
        <input type="hidden" name="csrf" value="<?= h(csrf()) ?>" />
        <button type="submit">Sign out on this device</button>
      </form>
    </footer>
    <?php endif ?>
  </div>
  <?php foreach ($pageScripts ?? [] as $src): ?><script src="<?= asset($src) ?>" defer></script>
  <?php endforeach ?>
  <?php foreach ($pageModules ?? [] as $src): ?><script src="<?= asset($src) ?>" type="module"></script>
  <?php endforeach ?>
</body>
</html>
