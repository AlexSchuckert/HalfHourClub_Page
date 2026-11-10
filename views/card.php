<?php /** One club in a list: used by home, category and contributor pages. */ ?>
<li>
  <a class="club-card" href="<?= h(club_url($card)) ?>">
    <h3 class="club-card__title"><?= h($card['title']) ?></h3>
    <p class="club-card__meta"><?= h(date_label($card['date'])) ?><?= ($t = time_label($card['start_time'], $card['end_time'])) !== '' ? ', ' . h($t) : '' ?><?= $card['location'] !== '' ? ' · ' . h($card['location']) : '' ?></p>
    <?php if (($excerpt = plain_excerpt($card['prompt'])) !== ''): ?><p class="club-card__prompt"><?= h($excerpt) ?></p><?php endif ?>
    <?php if ($card['contributions']): ?>
    <div class="club-card__chips">
      <?php foreach ($card['contributions'] as $c): ?>
        <span class="club-card__chip tint-<?= h(colour_of($c['category'], $colours)) ?>"><?= h(people_label($c['people'])) ?> — <?= h($c['category']) ?></span>
      <?php endforeach ?>
    </div>
    <?php endif ?>
  </a>
</li>
