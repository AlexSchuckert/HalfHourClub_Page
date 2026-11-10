<?php $pageScripts = ['/assets/calendar.js'];
$latestMonth = $days ? substr(array_key_last($days), 0, 7) : ''; ?>
<section class="section">
  <div class="panel">
    <div class="calendar" id="calendar" data-latest-month="<?= h($latestMonth) ?>">
      <div class="calendar__bar">
        <button class="calendar__nav" type="button" data-calendar-prev aria-label="Previous month">‹</button>
        <h2 class="calendar__month" data-calendar-month>&nbsp;</h2>
        <button class="calendar__nav" type="button" data-calendar-next aria-label="Next month">›</button>
      </div>
      <div class="calendar__grid" data-calendar-grid></div>
      <div class="calendar__choices" data-calendar-choices></div>
    </div>
  </div>
</section>
<script id="calendar-data" type="application/json"><?= inline_json((object)$days) ?></script>

<?php if ($categories): ?>
<section class="section">
  <h2 class="section__heading">Categories</h2>
  <ul class="chips">
    <?php foreach ($categories as $c): ?>
      <li><a class="chip tint-<?= h($c['colour']) ?>" href="<?= h(category_url($c['name'])) ?>"><?= h($c['name']) ?> <span class="chip__count"><?= (int)$c['clubs'] ?></span></a></li>
    <?php endforeach ?>
  </ul>
</section>
<?php endif ?>

<?php if ($contributors): ?>
<section class="section">
  <h2 class="section__heading">Contributors</h2>
  <ul class="chips">
    <?php foreach ($contributors as $c): ?>
      <li><a class="chip chip--plain" href="<?= h(contributor_url($c['name'])) ?>"><?= h($c['name']) ?> <span class="chip__count"><?= (int)$c['clubs'] ?></span></a></li>
    <?php endforeach ?>
  </ul>
</section>
<?php endif ?>

<section class="section">
  <h2 class="section__heading">Recent</h2>
  <?php if ($cards): ?>
    <ul class="club-list"><?php foreach ($cards as $card) partial('card', ['card' => $card, 'colours' => $colours]) ?></ul>
    <p class="section__more"><?= $clubCount ?> half hour club<?= $clubCount === 1 ? '' : 's' ?> so far</p>
  <?php else: ?>
    <p class="empty-note">No half hour clubs yet. Tap <a href="/new/">＋ New half hour club</a> to add the first one.</p>
  <?php endif ?>
</section>
