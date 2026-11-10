<?php $pageScripts = ['/assets/gallery.js']; $editUrl = club_url($club) . 'edit/'; ?>
<article>
  <header class="club-header">
    <h2 class="club-header__title"><?= h($club['title']) ?></h2>
    <p class="club-header__meta">
      <?php if ($club['location'] !== ''): ?><span><?= h($club['location']) ?></span><?php endif ?>
      <span><?= h(date_label($club['date'])) ?><?= ($t = time_label($club['start_time'], $club['end_time'])) !== '' ? ', ' . h($t) : '' ?></span>
    </p>
    <?php if (trim($club['prompt']) !== ''): ?>
      <div class="prompt"><span class="prompt__label">Prompt</span><?= render_markdown($club['prompt']) ?></div>
    <?php endif ?>
  </header>

  <?php if ($club['contributions']): ?>
  <div class="contributions">
    <?php foreach ($club['contributions'] as $c): ?>
      <details class="contribution">
        <summary class="contribution__summary">
          <span class="contribution__caret" aria-hidden="true">▶</span>
          <span class="contribution__who"><?= h(people_label($c['people'])) ?></span>
          <span class="contribution__category tint-<?= h(colour_of($c['category'], $colours)) ?>"><?= h($c['category']) ?></span>
        </summary>
        <div class="contribution__body"><?= render_markdown($c['body']) ?></div>
      </details>
    <?php endforeach ?>
  </div>
  <?php else: ?>
    <p class="empty-note">Nothing recorded for this session yet.</p>
  <?php endif ?>
</article>
