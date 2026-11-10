/**
 * The "New half hour club" form: add a session, or edit or delete one.
 *
 * Each photo or video is compressed on this device, then uploaded the moment
 * it's ready, while you carry on typing. Saving sends only the words, so it
 * takes a fraction of a second, and the club page opens straight away. There is
 * no build step any more: what you saved is what the next page view shows.
 */

import { processImage } from './image.js';
import { processVideo } from './video.js';
import { saveClub, deleteClub, geocode, uploadMedia } from './api.js';

const config = JSON.parse(document.getElementById('form-config').textContent);
const editing = config.club;

const form = document.getElementById('club-form');
const contributionsHost = document.getElementById('contributions');
const template = document.getElementById('contribution-template');
const statusElement = form.querySelector('[data-status]');
const publishButton = form.querySelector('[data-publish]');
const deleteButton = form.querySelector('[data-delete]');
const locationHint = form.querySelector('[data-location-hint]');

const LAST_LOCATION_KEY = 'hhc:last-location';
const OTHER_CATEGORY = '__other__';
const IMAGE_TYPES = /^image\//;
const VIDEO_TYPES = /^video\//;

/** One handle per contribution block on the page, in display order. */
const contributions = [];
/** Files still compressing or uploading; saving waits for these. */
const pending = new Set();
let saved = false;

/* ---------------------------------------------------------------- helpers */

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
 * Fill in Location. The last place used goes in immediately (clubs tend to
 * repeat in the same spot), then GPS gets a chance to do better.
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
  locationHint.textContent = 'Finding where you are…';
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 8000,
        maximumAge: 600_000, // a ten-minute-old fix is plenty for "which village"
      });
    });
    const { location } = await geocode(position.coords.latitude, position.coords.longitude);
    if (location) {
      form.elements.location.value = location;
      locationHint.textContent = `Filled in from your location — change it if it's wrong.`;
    } else {
      locationHint.textContent = quiet ? '' : 'Could not name that place.';
    }
  } catch (error) {
    // A denied permission is a normal answer, not a failure worth shouting about.
    // Anything else came from the server, which says what went wrong.
    const fromPhone = typeof GeolocationPositionError !== 'undefined' && error instanceof GeolocationPositionError;
    locationHint.textContent = quiet ? '' : fromPhone ? 'Could not get your location — type it in instead.' : error.message;
  }
}

/* ------------------------------------------------------- contribution block */

function renumber() {
  const blocks = contributionsHost.querySelectorAll('[data-contribution]');
  blocks.forEach((block, index) => {
    block.querySelector('.contribution-editor__index').textContent = `Contribution ${index + 1}`;
    block.querySelector('[data-remove]').hidden = blocks.length === 1;
  });
}

function buildCategorySelect(select) {
  select.textContent = '';
  for (const name of config.categories) select.append(new Option(name, name));
  select.append(new Option('Other…', OTHER_CATEGORY));
}

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
    if (contributions.length === 1) return;
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
    // The preview must render media from the private /media/ route, like the page does.
    previewRender: (text, preview) => {
      setTimeout(() => {
        preview.querySelectorAll('img').forEach((img) => {
          const match = img.getAttribute('src')?.match(/^(?:\.\/)?media\/(.+)$/);
          if (match) img.src = `/media/${match[1]}?size=display`;
        });
      });
      return editor.markdown(text);
    },
  });

  const handle = {
    block,
    editor,
    get contributors() {
      return parseContributors(contributorsInput.value);
    },
    get category() {
      return categorySelect.value === OTHER_CATEGORY ? newCategoryInput.value.trim() || 'Other' : categorySelect.value;
    },
    get body() {
      return editor.value();
    },
  };

  wireDropzone({ dropzone, fileInput, attachmentList, handle });

  if (initial.contributors?.length) contributorsInput.value = initial.contributors.join(', ');
  if (initial.category) {
    const known = config.categories.find((c) => c.toLowerCase() === initial.category.toLowerCase());
    if (known) {
      categorySelect.value = known;
    } else {
      categorySelect.value = OTHER_CATEGORY;
      newCategoryInput.hidden = false;
      newCategoryInput.value = initial.category;
    }
  }

  // When editing, list the files this contribution already shows.
  for (const [, name] of (initial.body ?? '').matchAll(/media\/([a-f0-9]{8,32}\.[a-z0-9]{2,5})/g)) {
    const row = attachmentRow(name);
    row.querySelector('.attachment__state').textContent = 'Already uploaded';
    row.querySelector('.attachment__bar span').style.width = '100%';
    row.querySelector('.attachment__remove').remove();
    attachmentList.append(row);
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
  dropzone.addEventListener('drop', (event) => handleFiles([...event.dataTransfer.files], { attachmentList, handle }));
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
 * Compress each dropped file, upload it, and put a reference in the text.
 * Files go one at a time on purpose: two hardware video encodes at once will
 * stall a phone, and the progress line stays honest this way.
 */
async function handleFiles(files, { attachmentList, handle }) {
  for (const file of files) {
    const isImage = IMAGE_TYPES.test(file.type) || /\.(hei[cf])$/i.test(file.name);
    const isVideo = VIDEO_TYPES.test(file.type);
    const row = attachmentRow(file.name);
    const state = row.querySelector('.attachment__state');
    const bar = row.querySelector('.attachment__bar span');
    const remove = row.querySelector('.attachment__remove');
    attachmentList.append(row);

    if (!isImage && !isVideo) {
      row.classList.add('attachment--failed');
      state.textContent = 'Only photos and videos, sorry';
      remove.addEventListener('click', () => row.remove());
      continue;
    }

    const job = (async () => {
      const report = (message, fraction) => {
        state.textContent = message;
        if (typeof fraction === 'number') bar.style.width = `${Math.round(fraction * 100)}%`;
      };
      const result = isVideo ? await processVideo(file, report) : await processImage(file, report);
      bar.style.width = '0%';
      const uploaded = await uploadMedia(result.blob, `upload.${result.extension}`, (fraction) =>
        report(`Uploading — ${Math.round(fraction * 100)}%`, fraction)
      );
      return { uploaded, size: result.blob.size };
    })();
    pending.add(job);

    try {
      const { uploaded, size } = await job;
      const caption = file.name.replace(/\.[^.]+$/, '').replace(/[[\]()]/g, '');
      // Image syntax for photos and video alike: the server turns a video
      // reference into a player, which keeps contributions free of raw HTML.
      const reference = `\n![${caption}](media/${uploaded.name})\n`;
      const codemirror = handle.editor.codemirror;
      codemirror.replaceRange(reference, codemirror.getCursor());
      bar.style.width = '100%';
      state.textContent = `Ready · ${(size / 1024 / 1024).toFixed(1)} MB`;
      remove.addEventListener('click', () => {
        handle.editor.value(handle.editor.value().replace(reference, '\n'));
        row.remove();
      });
    } catch (error) {
      row.classList.add('attachment--failed');
      state.textContent = error.message || 'Could not process this file';
      remove.addEventListener('click', () => row.remove());
    } finally {
      pending.delete(job);
    }
  }
}

/* ------------------------------------------------------------------ saving */

function readClub() {
  return {
    id: editing?.id,
    revision: editing?.revision ?? 0,
    title: form.elements.title.value.trim(),
    location: form.elements.location.value.trim(),
    date: form.elements.date.value,
    start: form.elements.start.value,
    end: form.elements.end.value,
    prompt: form.elements.prompt.value,
    contributions: contributions
      .filter((c) => c.contributors.length || c.body.trim())
      .map((c) => ({ contributors: c.contributors, category: c.category, body: c.body })),
  };
}

function problems(club) {
  const found = [];
  if (!club.title) found.push('the club needs a name');
  if (!club.date) found.push('the club needs a date');
  if (!club.contributions.length) found.push('add at least one contribution with a name and some content');
  else if (club.contributions.some((c) => !c.contributors.length)) found.push('every contribution needs a name');
  else if (club.contributions.some((c) => !c.body.trim())) found.push('every contribution needs some content');
  return found;
}

function busy(on) {
  publishButton.disabled = on;
  if (deleteButton) deleteButton.disabled = on;
}

async function publish(event) {
  event.preventDefault();
  if (pending.size) {
    setStatus(`Waiting for ${pending.size} file${pending.size === 1 ? '' : 's'} to finish uploading…`);
    busy(true);
    await Promise.allSettled([...pending]);
    busy(false);
  }
  const club = readClub();
  const found = problems(club);
  if (found.length) {
    setStatus(`Almost — ${found.join('; ')}.`, 'error');
    return;
  }
  busy(true);
  setStatus('Saving…');
  try {
    const { url } = await saveClub(club);
    if (club.location) localStorage.setItem(LAST_LOCATION_KEY, club.location);
    saved = true;
    window.location.href = url; // live already: no rebuild to wait for
  } catch (error) {
    setStatus(error.message, 'error');
    busy(false);
  }
}

async function remove() {
  const confirmation = window.prompt(
    `This deletes “${editing.title}” from the site.\n\nType the word delete to confirm.`
  );
  if (confirmation?.trim().toLowerCase() !== 'delete') {
    setStatus('Left alone.');
    return;
  }
  busy(true);
  setStatus('Deleting…');
  try {
    const { url } = await deleteClub(editing.id, editing.revision);
    saved = true;
    window.location.href = url;
  } catch (error) {
    setStatus(error.message, 'error');
    busy(false);
  }
}

/* ------------------------------------------------------------------- start */

form.addEventListener('submit', publish);
deleteButton?.addEventListener('click', remove);
form.querySelector('[data-locate]').addEventListener('click', () => detectLocation());
form.querySelector('[data-add-contribution]').addEventListener('click', () => addContribution());

// Don't lose a half-written poem to a stray swipe or a closed tab.
window.addEventListener('beforeunload', (event) => {
  if (saved) return;
  const changed = editing
    ? JSON.stringify(readClub().contributions) !== JSON.stringify(editing.contributions)
    : contributions.some((c) => c.body.trim());
  if (changed || pending.size) event.preventDefault();
});

if (editing) {
  for (const field of ['title', 'location', 'date', 'start', 'end', 'prompt']) form.elements[field].value = editing[field] ?? '';
  for (const c of editing.contributions) addContribution(c);
  if (!editing.contributions.length) addContribution();
} else {
  prefillDateAndTime();
  addContribution();
  prefillLocation();
}
