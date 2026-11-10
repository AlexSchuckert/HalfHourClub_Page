/**
 * End-to-end check in a real browser, against a running dev server with the
 * imported archive (see README). Covers what only a browser can: one sign-in
 * carrying across pages, the Edit button, in-browser compression and upload,
 * instant save, rename redirects, delete, and no Content-Security-Policy
 * violations from the editor or the media libraries.
 *
 *   HHC_TEST_URL=http://127.0.0.1:8000 HHC_TEST_PASSWORD=... node tests/browser.cjs
 */
const { chromium } = require('playwright');

const BASE = process.env.HHC_TEST_URL || 'http://127.0.0.1:8000';
const PASSWORD = process.env.HHC_TEST_PASSWORD || 'local-family-pw';
const RUN = Date.now().toString(36);
const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content.Security.Policy/i.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));

  // --- Sign in once ---------------------------------------------------------
  await page.goto(`${BASE}/clubs/2026-08-12-holidays/`);
  check('Signed-out visit lands on the sign-in page', page.url().includes('/login/'), new URL(page.url()).pathname);
  await page.fill('#password', 'wrong');
  await page.press('#password', 'Enter');
  check('A wrong password is refused', (await page.textContent('body')).includes("not the password"));
  await page.fill('#password', PASSWORD);
  await page.press('#password', 'Enter');
  await page.waitForSelector('.club-header__title');
  check('The right password returns you to the page you wanted', page.url().endsWith('/clubs/2026-08-12-holidays/'));

  await page.goto(`${BASE}/`);
  await page.waitForSelector('.calendar__grid');
  const dots = await page.locator('.calendar__dot').count();
  check('Home shows the calendar without asking again', dots >= 1, `${dots} dot(s) this month`);
  await page.goto(`${BASE}/clubs/2026-10-18-watercolor-after-cousinfest/`);
  check('Other pages need no password either', !page.url().includes('/login/'));

  // --- Edit button, top right ------------------------------------------------
  const edit = page.locator('.masthead__actions a', { hasText: 'Edit' });
  check('Club page has an Edit button in the header', (await edit.count()) === 1);
  await edit.click();
  await page.waitForSelector('.EasyMDEContainer');
  check('Edit opens this club in the form', (await page.inputValue('#field-title')) === 'Watercolor after cousinfest');
  check('Existing photos are listed as already uploaded', (await page.locator('.attachment__state', { hasText: 'Already uploaded' }).count()) >= 1);

  // --- A new club, with a photo and a video ----------------------------------
  await page.goto(`${BASE}/new/`);
  await page.waitForSelector('.EasyMDEContainer');
  await page.fill('#field-title', `Browser test club ${RUN}`);
  await page.fill('#field-location', 'Testville');
  await page.fill('[data-contributors]', 'Ella & Alex');
  await page.locator('.CodeMirror').first().click();
  await page.keyboard.type('A line of verse\nand another');

  const photo = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(3000, 2000);
    const g = canvas.getContext('2d');
    const px = g.createImageData(3000, 2000);
    for (let i = 0; i < px.data.length; i += 4) { px.data[i] = Math.random() * 255; px.data[i + 1] = 120; px.data[i + 2] = 200; px.data[i + 3] = 255; }
    g.putImageData(px, 0, 0);
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('[data-file-input]', { name: 'IMG_0001.png', mimeType: 'image/png', buffer: Buffer.from(photo) });
  await page.waitForSelector('.attachment__state:has-text("Ready")', { timeout: 60000 });
  check('Photo compressed and uploaded while editing', true, await page.locator('.attachment__state').last().textContent());

  const clip = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const g = canvas.getContext('2d'); const noise = g.createImageData(640, 360);
    const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8e6 });
    const chunks = []; recorder.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => (recorder.onstop = r)); recorder.start();
    const t = setInterval(() => { for (let i = 0; i < noise.data.length; i += 4) { const v = Math.random() * 255; noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v; noise.data[i + 3] = 255; } g.putImageData(noise, 0, 0); }, 40);
    await new Promise((r) => setTimeout(r, 2000)); clearInterval(t); recorder.stop(); await done;
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await page.setInputFiles('[data-file-input]', { name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(clip) });
  await page.waitForFunction(() => document.querySelectorAll('.attachment__state').length === 2 && /Ready/.test(document.querySelectorAll('.attachment__state')[1].textContent), null, { timeout: 120000 });
  check('Video compressed and uploaded', true, await page.locator('.attachment__state').last().textContent());

  const started = Date.now();
  await page.click('[data-publish]');
  await page.waitForURL(new RegExp(`/clubs/\\d{4}-\\d{2}-\\d{2}-browser-test-club-${RUN}/$`));
  await page.waitForSelector('.club-header__title');
  const elapsed = Date.now() - started;
  check('Saving opens the live club page straight away', elapsed < 3000, `${elapsed} ms from Save to page`);
  const newUrl = page.url();

  await page.locator('.contribution__summary').first().click();
  const img = page.locator('.contribution__body img.media-image');
  await img.waitFor();
  const loaded = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
  check('The photo shows, from its display copy', loaded && (await img.getAttribute('src')).includes('size=display'), `${await img.evaluate((el) => el.naturalWidth)}px wide`);
  const video = page.locator('.contribution__body video');
  check('The video became a player', (await video.count()) === 1);
  const seekable = await video.evaluate(async (v) => { await new Promise((r) => (v.readyState >= 1 ? r() : (v.onloadedmetadata = r))); return v.duration > 0; });
  check('The video loads and has a duration', seekable);
  check('Verse line breaks survive', (await page.innerHTML('.contribution__body')).includes('<br>'));

  // --- Rename through the form, then the old address still works ----------
  await page.click('.masthead__actions a:has-text("Edit")');
  await page.waitForSelector('.EasyMDEContainer');
  await page.fill('#field-title', `Browser test club ${RUN} renamed`);
  await page.click('[data-publish]');
  await page.waitForURL(new RegExp(`browser-test-club-${RUN}-renamed/$`));
  const renamedUrl = page.url();
  check('Edits save and open the page', true);
  await page.goto(newUrl);
  check('The old address redirects to the new one', page.url() === renamedUrl);

  // --- Delete ----------------------------------------------------------------
  await page.click('.masthead__actions a:has-text("Edit")');
  await page.waitForSelector('[data-delete]');
  page.once('dialog', (d) => d.accept('delete'));
  await page.click('[data-delete]');
  await page.waitForURL(`${BASE}/`);
  const gone = await page.goto(renamedUrl);
  check('Deleted clubs are gone from the site', gone.status() === 404);

  const realProblems = problems.filter((p) => !/favicon/i.test(p) && !/status of 404/.test(p));
  check('No console errors or CSP violations', realProblems.length === 0, realProblems.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
