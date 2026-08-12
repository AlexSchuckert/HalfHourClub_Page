/**
 * The "New half hour club" form: add a session, edit one, or delete one.
 *
 * How a save works
 * ----------------
 *  1. Swap the publish key (baked into this encrypted page) for a one-hour
 *     GitHub token from /api/auth.
 *  2. Turn every dropped file into something small: photos to ≤3 MB JPEG,
 *     videos to ~19 MB/min H.264 — all on this device, so the upload is quick.
 *  3. Write club.md, one markdown file per contribution, and the media, in a
 *     single commit. That push triggers the rebuild.
 *
 * Edit mode is the same form with ?edit=<slug>: it loads the existing files,
 * and on save rewrites the contributions folder, moves media if the club's date
 * or name changed, and deletes anything no longer referenced.
 */

import { getToken, commitFiles, listClubFiles, readTextFile } from './github.js';
import { processImage } from './image.js';
import { processVideo } from './video.js';

const config = JSON.parse(document.getElementById('form-config').textContent);

const form = document.getElementById('club-form');
const contributionsHost = document.getElementById('contributions');
const template = document.getElementById('contribution-template');
const statusElement = form.querySelector('[data-status]');
const publishButton = form.querySelector('[data-publish]');
const deleteButton = form.querySelector('[data-delete]');
const finishedLink = form.querySelector('[data-finished]');
const locationHint = form.querySelector('[data-location-hint]');

const LAST_LOCATION_KEY = 'hhc:last-location';
const OTHER_CATEGORY = '__other__';
const IMAGE_TYPES = /^image\//;
const VIDEO_TYPES = /^video\//;

/** The slug being edited, or null when adding. */
const editingSlug = new URLSearchParams(window.location.search).get('edit');

/** Media the club already has: path → {sha, name}. Only used when editing. */
let existingMedia = new Map();
/** Paths the club currently occupies, so a save can clean up what it replaces. */
let existingPaths = [];

/** One handle per contribution block on the page, in display order. */
const contributions = [];

/* ---------------------------------------------------------------- helpers */

const slugify = (value) =>
  String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const pad = (n) => String(n).padStart(2, '0');

function setStatus(message, kind = '') {
  statusElement.textContent = message;
  statusElement.className = `publish-bar__status${kind ? ` publish-bar__status--${kind}` : ''}`;
}

/** Split "Ella & Alex" or "Ella, Alex" into names. */
const parseContributors = (value) =>
  String(value)
    .split(/[,&]| and /i)
    .map((name) => name.trim())
    .filter(Boolean);

/** A short random name, so media files never collide and can't be guessed. */
function mediaName(extension) {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex}.${extension}`;
}

/** Quote a value for YAML front matter only when it needs it. */
function yamlString(value) {
  const text = String(value ?? '');
  if (text === '') return "''";
  // Anything that could be read as another YAML type, or that contains
  // structural punctuation, gets quoted with internal quotes doubled.
  if (/^[\w .()'&/-]+$/.test(text) && !/^(yes|no|true|false|null|on|off)$/i.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "''")}'`;
}

const yamlList = (values) => `[${values.map(yamlString).join(', ')}]`;

/* --------------------------------------------------------- club-level form */

/** Date and time prefilled to now, with the session running the usual half hour. */
function prefillDateAndTime() {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 60 * 1000);

  form.elements.date.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  form.elements.start.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  form.elements.end.value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

/**
 * Fill in Location.
 *
 * The last place used goes in immediately — clubs tend to repeat in the same
 * spot, and it means the field is never empty while GPS thinks about it. Then
 * ask for the real position and let it win if the browser obliges.
 */
async function prefillLocation() {
  const remembered = localStorage.getItem(LAST_LOCATION_KEY);
  if (remembered) form.elements.location.value = remembered;

  await detectLocation({ quiet: true });
}

async function detectLocation({ quiet = false } = {}) {
  if (!('geolocation' in navigator)) {
    if (!quiet) locationHint.textContent = 'This browser has no location support.';
    return;
  }

  if (!config.publishKey) {
    if (!quiet) locationHint.textContent = 'Location lookup needs the site to be fully configured.';
    return;
  }

  locationHint.textContent = 'Finding where you are…';

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 8000,
        maximumAge: 600_000, // a ten-minute-old fix is plenty for "which village"
      });
    });

    const response = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: config.publishKey,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (response.ok && body.location) {
      form.elements.location.value = body.location;
      locationHint.textContent = `Filled in from your location — change it if it's wrong.`;
    } else {
      locationHint.textContent = quiet ? '' : body.error || 'Could not name that place.';
    }
  } catch (error) {
    // A denied permission is a normal answer, not a failure worth shouting about.
    locationHint.textContent =
      quiet && error?.code === 1 ? '' : 'Could not get your location — type it in instead.';
  }
}

/* ------------------------------------------------------- contribution block */

function renumber() {
  contributionsHost.querySelectorAll('[data-contribution]').forEach((block, index) => {
    block.querySelector('.contribution-editor__index').textContent = `Contribution ${index + 1}`;
    block.querySelector('[data-remove]').hidden =
      contributionsHost.querySelectorAll('[data-contribution]').length === 1;
  });
}

function buildCategorySelect(select) {
  select.textContent = '';
  for (const name of config.categories) {
    select.append(new Option(name, name));
  }
  select.append(new Option('Other…', OTHER_CATEGORY));
}

/**
 * @returns {object} a handle on the new block: its element, its editor and its
 *                   attachments, so publish() can read everything back out.
 */
function addContribution(initial = {}) {
  const fragment = template.content.cloneNode(true);
  const block = fragment.querySelector('[data-contribution]');
  const contributorsInput = block.querySelector('[data-contributors]');
  const categorySelect = block.querySelector('[data-category]');
  const newCategoryInput = block.querySelector('[data-new-category]');
  const textarea = block.querySelector('[data-editor]');
  const dropzone = block.querySelector('[data-dropzone]');
  const fileInput = block.querySelector('[data-file-input]');
  const attachmentList = block.querySelector('[data-attachments]');
  const quickNames = block.querySelector('[data-quick-names]');

  buildCategorySelect(categorySelect);

  // Tapping a known name appends it rather than replacing what's there, so
  // joint contributions are a couple of taps.
  for (const name of config.contributors) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', () => {
      const current = parseContributors(contributorsInput.value);
      if (!current.includes(name)) current.push(name);
      contributorsInput.value = current.join(', ');
    });
    quickNames.append(button);
  }

  categorySelect.addEventListener('change', () => {
    const isOther = categorySelect.value === OTHER_CATEGORY;
    newCategoryInput.hidden = !isOther;
    if (isOther) newCategoryInput.focus();
  });

  block.querySelector('[data-remove]').addEventListener('click', () => {
    if (contributionsHost.querySelectorAll('[data-contribution]').length === 1) return;
    handle.editor.toTextArea();
    block.remove();
    contributions.splice(contributions.indexOf(handle), 1);
    renumber();
  });

  contributionsHost.append(fragment);

  const editor = new window.EasyMDE({
    element: textarea,
    initialValue: initial.body ?? '',
    spellChecker: false,
    autoDownloadFontAwesome: false,
    status: false,
    toolbar: ['bold', 'italic', 'heading', '|', 'quote', 'unordered-list', '|', 'preview', 'guide'],
  });

  const handle = {
    block,
    editor,
    attachments: [],
    /** Media already in the repo that this contribution's text refers to. */
    keptMedia: new Set(),
    get contributors() {
      return parseContributors(contributorsInput.value);
    },
    get category() {
      return categorySelect.value === OTHER_CATEGORY
        ? newCategoryInput.value.trim() || 'Other'
        : categorySelect.value;
    },
    get body() {
      return editor.value();
    },
  };

  wireDropzone({ dropzone, fileInput, attachmentList, handle });

  // Restore an existing contribution's fields.
  if (initial.contributors?.length) contributorsInput.value = initial.contributors.join(', ');
  if (initial.category) {
    if (config.categories.includes(initial.category)) {
      categorySelect.value = initial.category;
    } else {
      categorySelect.value = OTHER_CATEGORY;
      newCategoryInput.hidden = false;
      newCategoryInput.value = initial.category;
    }
  }

  contributions.push(handle);
  renumber();
  return handle;
}

/* ----------------------------------------------------------------- uploads */

function wireDropzone({ dropzone, fileInput, attachmentList, handle }) {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (event) => {
      stop(event);
      dropzone.classList.add('dropzone--over');
    });
  }

  for (const type of ['dragleave', 'drop']) {
    dropzone.addEventListener(type, (event) => {
      stop(event);
      dropzone.classList.remove('dropzone--over');
    });
  }

  dropzone.addEventListener('drop', (event) => {
    handleFiles([...event.dataTransfer.files], { attachmentList, handle });
  });

  dropzone.querySelector('[data-pick]').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    handleFiles([...fileInput.files], { attachmentList, handle });
    fileInput.value = '';
  });
}

function attachmentRow(name) {
  const row = document.createElement('li');
  row.className = 'attachment';
  row.innerHTML = `
    <span class="attachment__name"></span>
    <span class="attachment__bar"><span></span></span>
    <span class="attachment__state">Waiting…</span>
    <button type="button" class="attachment__remove" title="Remove">✕</button>
  `;
  row.querySelector('.attachment__name').textContent = name;
  return row;
}

/**
 * Shrink each dropped file and drop a markdown reference into the editor.
 *
 * Files are processed one at a time on purpose: two hardware video encodes at
 * once will stall a phone, and the progress line stays honest this way.
 */
async function handleFiles(files, { attachmentList, handle }) {
  for (const file of files) {
    const isImage = IMAGE_TYPES.test(file.type) || /\.(hei[cf])$/i.test(file.name);
    const isVideo = VIDEO_TYPES.test(file.type);

    const row = attachmentRow(file.name);
    const state = row.querySelector('.attachment__state');
    const bar = row.querySelector('.attachment__bar span');
    attachmentList.append(row);

    if (!isImage && !isVideo) {
      row.classList.add('attachment--failed');
      state.textContent = 'Only photos and videos, sorry';
      row.querySelector('.attachment__remove').addEventListener('click', () => row.remove());
      continue;
    }

    try {
      const report = (message, fraction) => {
        state.textContent = message;
        if (typeof fraction === 'number') bar.style.width = `${Math.round(fraction * 100)}%`;
      };

      const result = isVideo
        ? await processVideo(file, report)
        : await processImage(file, report);

      const name = mediaName(result.extension);
      const caption = file.name.replace(/\.[^.]+$/, '').replace(/[[\]()]/g, '');

      handle.attachments.push({ name, blob: result.blob });

      // Markdown image syntax for both photos and video: the build turns a
      // video reference into a real player (see lib/render.mjs), which keeps
      // contributions free of raw HTML.
      const reference = `\n![${caption}](media/${name})\n`;
      const codemirror = handle.editor.codemirror;
      codemirror.replaceRange(reference, codemirror.getCursor());

      bar.style.width = '100%';
      state.textContent = `Ready · ${(result.blob.size / 1024 / 1024).toFixed(1)} MB`;

      row.querySelector('.attachment__remove').addEventListener('click', () => {
        handle.attachments = handle.attachments.filter((item) => item.name !== name);
        // Take the reference out of the text too, so it doesn't 404.
        handle.editor.value(handle.editor.value().replace(reference, '\n'));
        row.remove();
      });
    } catch (error) {
      row.classList.add('attachment--failed');
      state.textContent = error.message || 'Could not process this file';
      row.querySelector('.attachment__remove').addEventListener('click', () => row.remove());
    }
  }
}

/* ------------------------------------------------------------ file building */

function clubMarkdown(fields) {
  return [
    '---',
    `title: ${yamlString(fields.title)}`,
    `location: ${yamlString(fields.location)}`,
    `date: ${fields.date}`,
    `start: ${yamlString(fields.start)}`,
    `end: ${yamlString(fields.end)}`,
    '---',
    fields.prompt.trim(),
    '',
  ].join('\n');
}

function contributionMarkdown(contribution) {
  return [
    '---',
    `contributors: ${yamlList(contribution.contributors)}`,
    `category: ${yamlString(contribution.category)}`,
    '---',
    contribution.body.trim(),
    '',
  ].join('\n');
}

function readClubFields() {
  return {
    title: form.elements.title.value.trim(),
    location: form.elements.location.value.trim(),
    date: form.elements.date.value,
    start: form.elements.start.value,
    end: form.elements.end.value,
    prompt: form.elements.prompt.value,
  };
}

function validate(fields) {
  const problems = [];
  if (!fields.title) problems.push('the club needs a name');
  if (!fields.date) problems.push('the club needs a date');

  const filled = contributions.filter(
    (contribution) => contribution.contributors.length && contribution.body.trim()
  );
  if (!filled.length) problems.push('add at least one contribution with a name and some content');

  for (const contribution of contributions) {
    if (contribution.body.trim() && !contribution.contributors.length) {
      problems.push('every contribution needs a name');
      break;
    }
  }

  return { problems, filled };
}

/**
 * Work out the whole commit: which files to write, and which to remove.
 *
 * Contributions are always rewritten wholesale under fresh NN- names, because
 * removing the second of three would otherwise leave a stale 03- file behind.
 * Media is treated the other way round — kept if the text still refers to it,
 * deleted if not, and pointed at by sha rather than re-uploaded when a club is
 * renamed.
 */
function buildCommit(fields, filled) {
  const slug = `${fields.date}-${slugify(fields.title)}`;
  const folder = `clubs/${slug}`;

  const files = [{ path: `${folder}/club.md`, content: clubMarkdown(fields) }];

  filled.forEach((contribution, index) => {
    const who = slugify(contribution.contributors.join('-')) || 'anonymous';
    const what = slugify(contribution.category) || 'other';
    files.push({
      path: `${folder}/contributions/${pad(index + 1)}-${who}-${what}.md`,
      content: contributionMarkdown(contribution),
    });
  });

  // Newly processed media.
  for (const contribution of filled) {
    for (const attachment of contribution.attachments) {
      files.push({ path: `${folder}/media/${attachment.name}`, content: attachment.blob });
    }
  }

  // Media already in the repo: keep the ones still referenced, at their new
  // path if the club was renamed.
  const allText = filled.map((contribution) => contribution.body).join('\n');
  const keptNames = new Set();

  for (const [path, media] of existingMedia) {
    if (!allText.includes(`media/${media.name}`)) continue;
    keptNames.add(media.name);
    const newPath = `${folder}/media/${media.name}`;
    if (newPath !== path) files.push({ path: newPath, sha: media.sha });
  }

  // Anything the club used to have that isn't in the new set comes out.
  const writtenPaths = new Set(files.map((file) => file.path));
  const deletions = existingPaths.filter((path) => !writtenPaths.has(path));

  return { slug, files, deletions };
}

/* ------------------------------------------------------------------ publish */

async function publish(event) {
  event.preventDefault();

  const fields = readClubFields();
  const { problems, filled } = validate(fields);

  if (problems.length) {
    setStatus(`Almost — ${problems.join('; ')}.`, 'error');
    return;
  }

  if (!config.publishKey) {
    setStatus('Publishing is switched off here: HHC_PUBLISH_KEY is not set.', 'error');
    return;
  }

  publishButton.disabled = true;
  deleteButton.disabled = true;

  try {
    setStatus('Getting permission to publish…');
    const auth = await getToken(config.publishKey);

    const { slug, files, deletions } = buildCommit(fields, filled);

    await commitFiles(auth, {
      files,
      deletions,
      message: editingSlug
        ? `Update half hour club “${fields.title}”`
        : `Add half hour club “${fields.title}”`,
      onProgress: setStatus,
    });

    localStorage.setItem(LAST_LOCATION_KEY, fields.location);

    if (editingSlug) {
      // The page already exists, so it's safe to go and look at it.
      setStatus('Saved. The site is rebuilding — give it about a minute.', 'done');
      setTimeout(() => {
        window.location.href = `/clubs/${slug}/`;
      }, 2500);
      return;
    }

    /* A brand-new club has no page until the rebuild finishes, so sending
       anyone there now would land them on a 404. Say what happens next and
       leave them in charge of when to move. */
    setStatus(
      'Published. It takes about a minute to appear on the site — ' +
        'the calendar will have it shortly.',
      'done'
    );
    publishButton.hidden = true;
    finishedLink.hidden = false;
    finishedLink.href = `/clubs/${slug}/`;
  } catch (error) {
    setStatus(error.message || 'Something went wrong publishing.', 'error');
    publishButton.disabled = false;
    deleteButton.disabled = false;
  }
}

async function remove() {
  const fields = readClubFields();
  const confirmation = window.prompt(
    `This deletes “${fields.title}” and everything in it.\n\n` +
      `Type the word delete to confirm.`
  );

  if (confirmation?.trim().toLowerCase() !== 'delete') {
    setStatus('Left alone.');
    return;
  }

  publishButton.disabled = true;
  deleteButton.disabled = true;

  try {
    setStatus('Getting permission…');
    const auth = await getToken(config.publishKey);

    await commitFiles(auth, {
      deletions: existingPaths,
      message: `Delete half hour club “${fields.title}”`,
      onProgress: setStatus,
    });

    setStatus('Deleted. The site is rebuilding.', 'done');
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);
  } catch (error) {
    setStatus(error.message || 'Could not delete it.', 'error');
    publishButton.disabled = false;
    deleteButton.disabled = false;
  }
}

/* --------------------------------------------------------------- edit mode */

/** Pull `key: value` pairs out of a front matter block. */
function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: text };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!pair) continue;

    let value = pair[2].trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      data[pair[1]] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^'(.*)'$/, '$1').replace(/''/g, "'"))
        .filter(Boolean);
      continue;
    }

    value = value.replace(/^'(.*)'$/, '$1').replace(/''/g, "'").replace(/^"(.*)"$/, '$1');
    data[pair[1]] = value;
  }

  return { data, body: match[2] };
}

async function loadForEditing(slug) {
  setStatus('Loading this club…');
  publishButton.disabled = true;

  const auth = await getToken(config.publishKey);
  const paths = await listClubFiles(auth, slug);

  if (!paths.length) throw new Error(`No club called “${slug}” in the archive.`);

  existingPaths = paths.map((entry) => entry.path);

  for (const entry of paths) {
    if (!entry.path.includes('/media/')) continue;
    existingMedia.set(entry.path, {
      sha: entry.sha,
      name: entry.path.split('/').pop(),
    });
  }

  const clubEntry = paths.find((entry) => entry.path.endsWith('/club.md'));
  const { data, body } = parseFrontMatter(await readTextFile(auth, clubEntry.path));

  form.elements.title.value = data.title ?? '';
  form.elements.location.value = data.location ?? '';
  form.elements.date.value = (data.date ?? slug.slice(0, 10)).slice(0, 10);
  form.elements.start.value = data.start ?? '';
  form.elements.end.value = data.end ?? '';
  form.elements.prompt.value = body.trim();

  const contributionPaths = paths
    .filter((entry) => entry.path.includes('/contributions/'))
    .sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));

  for (const entry of contributionPaths) {
    const parsed = parseFrontMatter(await readTextFile(auth, entry.path));
    addContribution({
      contributors: Array.isArray(parsed.data.contributors)
        ? parsed.data.contributors
        : [parsed.data.contributors].filter(Boolean),
      category: parsed.data.category,
      body: parsed.body.trim(),
    });
  }

  // Media already in the repo shows up in the list so it's clear it's there.
  for (const [, media] of existingMedia) {
    const owner = contributions.find((contribution) =>
      contribution.body.includes(`media/${media.name}`)
    );
    if (!owner) continue;
    const row = attachmentRow(media.name);
    row.querySelector('.attachment__state').textContent = 'Already uploaded';
    row.querySelector('.attachment__bar span').style.width = '100%';
    row.querySelector('.attachment__remove').remove();
    owner.block.querySelector('[data-attachments]').append(row);
  }

  document.querySelector('[data-mode-kicker]').textContent = 'Editing';
  document.querySelector('[data-mode-title]').textContent = data.title || slug;
  deleteButton.hidden = false;
  publishButton.textContent = 'Save changes';
  publishButton.disabled = false;
  setStatus('');
}

/* ------------------------------------------------------------------- start */

form.addEventListener('submit', publish);
deleteButton.addEventListener('click', remove);
form.querySelector('[data-locate]').addEventListener('click', () => detectLocation());
form.querySelector('[data-add-contribution]').addEventListener('click', () => addContribution());

// Don't lose a half-written poem to a stray swipe or a closed tab.
window.addEventListener('beforeunload', (event) => {
  const hasContent = contributions.some((contribution) => contribution.body.trim());
  if (hasContent && !publishButton.disabled) event.preventDefault();
});

if (editingSlug) {
  loadForEditing(editingSlug).catch((error) => {
    setStatus(error.message || 'Could not load that club.', 'error');
    publishButton.disabled = false;
  });
} else {
  prefillDateAndTime();
  addContribution();
  prefillLocation();
}
