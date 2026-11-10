<?php
$pageStyles = ['/assets/vendor/easymde.min.css', '/assets/new/form.css'];
// EasyMDE is a classic script and must exist before app.js runs: deferred
// scripts and modules execute in document order, and the layout emits these first.
$pageScripts = ['/assets/vendor/easymde.min.js'];
$pageModules = ['/assets/new/app.js'];
$config = [
    'csrf' => csrf(),
    'categories' => $choices['categories'],
    'contributors' => $choices['contributors'],
    'club' => $club ? [
        'id' => $club['id'], 'revision' => (int)$club['revision'], 'url' => club_url($club),
        'title' => $club['title'], 'location' => $club['location'], 'date' => $club['date'],
        'start' => $club['start_time'], 'end' => $club['end_time'], 'prompt' => $club['prompt'],
        'contributions' => array_map(fn($c) => ['contributors' => $c['people'], 'category' => $c['category'], 'body' => $c['body']], $club['contributions']),
    ] : null,
];
?>
<div class="page-heading">
  <p class="page-heading__kicker"><?= $club ? 'Editing' : 'New' ?></p>
  <h2 class="page-heading__title"><?= $club ? h($club['title']) : 'Half hour club' ?></h2>
</div>

<form id="club-form" novalidate>
  <section class="panel form-section">
    <div class="field">
      <label for="field-title">Name of this half hour club</label>
      <input id="field-title" name="title" type="text" required placeholder="Jesus and cicadas" />
    </div>
    <div class="field">
      <label for="field-location">Where</label>
      <div class="field__with-button">
        <input id="field-location" name="location" type="text" placeholder="Kardamyli" />
        <button class="button button--quiet" type="button" data-locate title="Find my location">Locate me</button>
      </div>
      <p class="field__hint" data-location-hint></p>
    </div>
    <div class="field-row">
      <div class="field"><label for="field-date">Date</label><input id="field-date" name="date" type="date" required /></div>
      <div class="field"><label for="field-start">Start</label><input id="field-start" name="start" type="time" /></div>
      <div class="field"><label for="field-end">End</label><input id="field-end" name="end" type="time" /></div>
    </div>
    <div class="field">
      <label for="field-prompt">Prompt</label>
      <textarea id="field-prompt" name="prompt" rows="3" placeholder="Pretend to be Jesus and include Cicadas in some way"></textarea>
    </div>
  </section>

  <h3 class="section__heading section__heading--spaced">Contributions</h3>
  <div id="contributions"></div>
  <p><button class="button" type="button" data-add-contribution>＋ Add a contribution</button></p>

  <div class="publish-bar">
    <button class="button button--primary" type="submit" data-publish><?= $club ? 'Save changes' : 'Publish' ?></button>
    <?php if ($club): ?>
      <a class="button button--quiet" href="<?= h(club_url($club)) ?>">Cancel</a>
      <button class="button button--danger" type="button" data-delete>Delete this club</button>
    <?php endif ?>
    <p class="publish-bar__status" data-status role="status" aria-live="polite"></p>
  </div>
</form>

<template id="contribution-template">
  <section class="panel contribution-editor" data-contribution>
    <div class="contribution-editor__head">
      <span class="contribution-editor__index"></span>
      <button class="contribution-editor__remove" type="button" data-remove title="Remove this contribution">Remove</button>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Who made it</label>
        <input type="text" data-contributors placeholder="Ella, or Ella & Alex" list="known-contributors" />
        <div class="quick-names" data-quick-names></div>
      </div>
      <div class="field">
        <label>What kind</label>
        <select data-category></select>
        <input type="text" data-new-category placeholder="New category name" hidden />
      </div>
    </div>
    <div class="field">
      <label>The contribution</label>
      <textarea data-editor rows="6"></textarea>
    </div>
    <div class="dropzone" data-dropzone tabindex="0">
      <p class="dropzone__label">Drop photos or videos here, or <button type="button" data-pick>choose files</button></p>
      <p class="dropzone__hint">Photos are shrunk to 3 MB · videos are compressed on this device before uploading</p>
      <input type="file" data-file-input multiple accept="image/*,video/*" hidden />
      <ul class="dropzone__list" data-attachments></ul>
    </div>
  </section>
</template>

<datalist id="known-contributors">
  <?php foreach ($choices['contributors'] as $name): ?><option value="<?= h($name) ?>"></option><?php endforeach ?>
</datalist>
<script id="form-config" type="application/json"><?= inline_json($config) ?></script>
