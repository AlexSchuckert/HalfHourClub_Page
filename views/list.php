<div class="page-heading">
  <p class="page-heading__kicker"><?= h($kind) ?></p>
  <h2 class="page-heading__title"><?= h($entry['name']) ?></h2>
  <p class="page-heading__sub"><?= (int)$entry['contributions'] ?> contribution<?= (int)$entry['contributions'] === 1 ? '' : 's' ?> across <?= (int)$entry['clubs'] ?> half hour club<?= (int)$entry['clubs'] === 1 ? '' : 's' ?></p>
</div>
<ul class="club-list"><?php foreach ($cards as $card) partial('card', ['card' => $card, 'colours' => $colours]) ?></ul>
