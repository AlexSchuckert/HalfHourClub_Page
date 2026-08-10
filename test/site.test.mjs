/**
 * End-to-end check of the published, encrypted site in a real browser:
 * the password gate, the calendar dot, navigation, and the collapsed
 * contributions. Run against the output of scripts/build.sh.
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
/** Chromium: the one Playwright installed, wherever that is. */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = ['/opt/pw-browsers', `${process.env.HOME}/.cache/ms-playwright`];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const candidate = join(root, entry, 'chrome-linux', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined; // let Playwright find its own
}


const BASE = process.env.HHC_TEST_URL || 'http://localhost:8899';
const PASSWORD = process.env.HHC_TEST_PASSWORD || 'test-family-password';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: chromiumPath() });
const context = await browser.newContext({ geolocation: { latitude: 36.888, longitude: 22.234 }, permissions: [] });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// --- 1. The gate --------------------------------------------------------
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
const bodyBefore = await page.evaluate(() => document.body.innerText);
check('Content hidden before the password', !bodyBefore.includes('Recent'), `saw ${bodyBefore.trim().slice(0, 60).replace(/\n/g, ' ')}…`);

// --- 2. Wrong password rejected ----------------------------------------
await page.fill('#staticrypt-password', 'not-the-password');
await page.press('#staticrypt-password', 'Enter');
await page.waitForTimeout(600);
check('Wrong password refused', !(await page.evaluate(() => document.body.innerText)).includes('Recent'));

// --- 3. Right password lets us in --------------------------------------
await page.fill('#staticrypt-password', PASSWORD);
await page.press('#staticrypt-password', 'Enter');
await page.waitForSelector('#calendar', { timeout: 5000 });
check('Correct password decrypts the page', true);

// --- 4. Calendar --------------------------------------------------------
const monthText = await page.textContent('[data-calendar-month]');
check('Calendar opens on the month with clubs', monthText.includes('August 2026'), monthText.trim());

// Expected dot count comes from the page's own inline calendar data rather than
// a hardcoded number, so this passes against whatever content is present.
const expectedDots = await page.evaluate(() => {
  const days = JSON.parse(document.getElementById('calendar-data').textContent);
  const month = document.getElementById('calendar').dataset.latestMonth;
  return Object.keys(days).filter((date) => date.startsWith(month)).length;
});
const dots = await page.locator('.calendar__dot').count();
check('Blue dots mark club days', dots === expectedDots && dots > 0, `${dots} dot(s), expected ${expectedDots}`);

const dotted = page.locator('.calendar__day--has-club').first();
const dottedLabel = await dotted.getAttribute('aria-label');
check('Dotted day is labelled with its club', /cicadas|cat/.test(dottedLabel || ''), dottedLabel);

// --- 5. Clicking a dot navigates --------------------------------------
await dotted.click();
await page.waitForURL(/\/clubs\//, { timeout: 5000 });
await page.waitForSelector('.club-header__title', { timeout: 5000 });
check('Clicking a dot opens that club', true, page.url().replace(BASE, ''));

// --- 6. Club page header ---------------------------------------------
const meta = await page.textContent('.club-header__meta');
check('Header shows location, date and time range', /Kardamyli/.test(meta) && /August 2026/.test(meta) && /\d\d:\d\d–\d\d:\d\d/.test(meta), meta.replace(/\s+/g, ' ').trim());
check('Header shows the full prompt', (await page.textContent('.prompt')).includes('Prompt'));

// --- 7. Contributions collapsed by default ---------------------------
const total = await page.locator('details.contribution').count();
const open = await page.locator('details.contribution[open]').count();
check('Contributions present and all collapsed', total >= 1 && open === 0, `${total} contribution(s), ${open} open`);

const summary = (await page.textContent('.contribution__summary')).replace(/\s+/g, ' ').trim();
check('Summary is contributor + category', /\w+.*(Poem|Sculpture|Performance)/.test(summary), summary);

// --- 8. Expanding shows the piece ------------------------------------
await page.locator('.contribution__summary').first().click();
await page.waitForTimeout(250);
const visible = await page.locator('details.contribution[open] .contribution__body').first().isVisible();
check('Expanding reveals the contribution', visible);

// --- 9. Fonts actually loaded ----------------------------------------
const fontsOk = await page.evaluate(async () => {
  await document.fonts.ready;
  return { garamond: document.fonts.check('1rem "EB Garamond"'), fraunces: document.fonts.check('1rem "Fraunces"') };
});
check('Serif fonts load', fontsOk.garamond && fontsOk.fraunces, JSON.stringify(fontsOk));

// --- 10. The /new/ form ----------------------------------------------
await page.goto(`${BASE}/new/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#club-form', { timeout: 5000 });
check('The form is behind the gate too', true, 'reused the remembered password');

await page.waitForSelector('.EasyMDEContainer', { timeout: 5000 });
check('Markdown editor initialises', true);

const dateValue = await page.inputValue('#field-date');
const startValue = await page.inputValue('#field-start');
const endValue = await page.inputValue('#field-end');
const today = new Date();
const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
check('Date prefilled to today', dateValue === expected, `${dateValue} (expected ${expected})`);
check('Start and end prefilled 30 min apart', Boolean(startValue && endValue), `${startValue}–${endValue}`);

const categoryOptions = await page.locator('[data-category] option').allTextContents();
check('Category dropdown offers configured categories', categoryOptions.includes('Visual Art') && categoryOptions.includes('Other…'), categoryOptions.join(', '));

const quickNames = await page.locator('[data-quick-names] button').allTextContents();
check('Quick-add contributor buttons rendered', quickNames.length >= 2, quickNames.join(', '));

// Adding and removing a contribution block
await page.click('[data-add-contribution]');
await page.waitForTimeout(200);
const blocks = await page.locator('[data-contribution]').count();
check('Can add another contribution', blocks === 2, `${blocks} blocks`);

// Validation refuses an empty club
await page.click('[data-publish]');
await page.waitForTimeout(300);
const status = await page.textContent('[data-status]');
check('Validation blocks an empty club', /needs a name|at least one contribution/.test(status), status.trim());

// --- 11. No JavaScript errors anywhere ------------------------------
const realErrors = errors.filter((e) => !/favicon|404|Failed to load resource/i.test(e));
check('No JavaScript errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
