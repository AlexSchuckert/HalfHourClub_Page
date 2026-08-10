/**
 * The data layer: read the club archive out of ./content and shape it into
 * everything the templates need — the clubs themselves, plus the category and
 * contributor indexes and the calendar.
 *
 * The content folder is fetched from the private HalfHourClub_Content repo by
 * scripts/fetch-content.sh before Eleventy runs, and is never committed here.
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { renderContent } from '../../lib/render.mjs';
import { dateLabel, timeLabel } from '../../lib/dates.mjs';

const CONTENT_DIR = 'content';
const CLUBS_DIR = path.join(CONTENT_DIR, 'clubs');

/** Colours handed out to categories that aren't pinned in categories.yml. */
const COLOUR_ROTATION = ['rose', 'sage', 'blue', 'lavender', 'honey', 'clay', 'mint'];

const slugify = (value) =>
  String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // drop accents so "Zoë" and "Zoe" agree
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function readYaml(file, fallback) {
  const full = path.join(CONTENT_DIR, file);
  if (!fs.existsSync(full)) return fallback;
  try {
    return yaml.load(fs.readFileSync(full, 'utf8')) ?? fallback;
  } catch (error) {
    console.warn(`[clubs] Ignoring ${file} — it isn't valid YAML: ${error.message}`);
    return fallback;
  }
}

/**
 * categories.yml and contributors.yml are both optional. They only supply
 * ordering, colours and alternative spellings; anything they don't mention is
 * discovered from the contributions themselves and appended. That's what lets
 * someone invent a category on the spot without editing config.
 */
function loadConfig() {
  const categoryConfig = readYaml('categories.yml', []) || [];
  const contributorConfig = readYaml('contributors.yml', []) || [];

  const categoryOrder = new Map();
  const categoryColours = new Map();
  // Names as written in the config, in config order. The /new/ form needs these
  // even for categories nothing uses yet, so a fresh archive still offers a
  // sensible dropdown rather than only "Other…".
  const configuredCategories = [];

  categoryConfig.forEach((entry, index) => {
    if (!entry?.name) return;
    categoryOrder.set(entry.name.toLowerCase(), index);
    configuredCategories.push(entry.name);
    if (entry.colour) categoryColours.set(entry.name.toLowerCase(), entry.colour);
  });

  const contributorOrder = new Map();
  const configuredContributors = [];
  const aliases = new Map(); // "ellie" → "Ella"

  contributorConfig.forEach((entry, index) => {
    if (!entry?.name) return;
    contributorOrder.set(entry.name.toLowerCase(), index);
    configuredContributors.push(entry.name);
    for (const alias of entry.also ?? []) {
      aliases.set(String(alias).toLowerCase(), entry.name);
    }
  });

  return {
    categoryOrder,
    categoryColours,
    configuredCategories,
    contributorOrder,
    configuredContributors,
    aliases,
  };
}

/** Contribution files are ordered by their NN- prefix, so 02 follows 01 and 10 doesn't jump ahead of 2. */
const byFilename = (a, b) => a.localeCompare(b, 'en', { numeric: true });

function readContributions(clubDir, clubUrl, aliases) {
  const dir = path.join(clubDir, 'contributions');
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort(byFilename)
    .map((file) => {
      const { data, content } = matter(fs.readFileSync(path.join(dir, file), 'utf8'));

      // `contributors` is a list so joint work is first-class, but tolerate a
      // bare string in case someone edits a file by hand.
      const rawNames = Array.isArray(data.contributors)
        ? data.contributors
        : [data.contributors ?? data.contributor ?? 'Anonymous'];

      const names = rawNames
        .map((name) => String(name).trim())
        .filter(Boolean)
        .map((name) => aliases.get(name.toLowerCase()) ?? name);

      const category = String(data.category ?? 'Other').trim() || 'Other';
      const bodyHtml = renderContent(content, clubUrl);

      return {
        file,
        contributors: names,
        // "Ella" · "Ella & Alex" · "Ella, Alex & Mira"
        contributorLabel:
          names.length <= 1
            ? names[0] ?? 'Anonymous'
            : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`,
        category,
        categorySlug: slugify(category),
        title: data.title ? String(data.title) : '',
        bodyHtml,
      };
    });
}

function readClub(slug, aliases) {
  const clubDir = path.join(CLUBS_DIR, slug);
  const clubFile = path.join(clubDir, 'club.md');

  if (!fs.existsSync(clubFile)) {
    console.warn(`[clubs] Skipping ${slug} — no club.md`);
    return null;
  }

  const { data, content } = matter(fs.readFileSync(clubFile, 'utf8'));
  const url = `/clubs/${slug}/`;

  // The folder name is the source of truth for the date (it's what sorts and
  // what the calendar keys on), with front matter as a fallback.
  const dateFromSlug = slug.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const date = dateFromSlug ?? (data.date ? String(data.date).slice(0, 10) : null);

  if (!date) {
    console.warn(`[clubs] Skipping ${slug} — no date in the folder name or front matter`);
    return null;
  }

  const contributions = readContributions(clubDir, url, aliases);
  const start = data.start ? String(data.start) : '';
  const end = data.end ? String(data.end) : '';

  return {
    slug,
    url,
    title: data.title ? String(data.title) : slug,
    location: data.location ? String(data.location) : '',
    date,
    dateLabel: dateLabel(date),
    start,
    end,
    timeLabel: timeLabel(start, end),
    promptHtml: renderContent(content, url),
    promptText: content.trim(),
    contributions,
    categories: [...new Set(contributions.map((c) => c.category))],
    contributors: [...new Set(contributions.flatMap((c) => c.contributors))],
  };
}

function buildCategories(clubs, { categoryOrder, categoryColours }) {
  const found = new Map();

  for (const club of clubs) {
    for (const contribution of club.contributions) {
      const key = contribution.category.toLowerCase();
      if (!found.has(key)) {
        found.set(key, { name: contribution.category, clubs: [], contributionCount: 0 });
      }
      const entry = found.get(key);
      entry.contributionCount += 1;
      // A club is listed once per category, however many contributions it has.
      if (!entry.clubs.includes(club)) entry.clubs.push(club);
    }
  }

  const unpinned = [];
  const categories = [...found.entries()].map(([key, entry]) => {
    const pinned = categoryOrder.has(key);
    if (!pinned) unpinned.push(key);
    return {
      ...entry,
      slug: slugify(entry.name),
      colour: categoryColours.get(key) ?? null,
      order: pinned ? categoryOrder.get(key) : Number.MAX_SAFE_INTEGER,
      count: entry.clubs.length,
    };
  });

  // Anything not pinned in categories.yml still needs a colour. Hand them out
  // from the rotation in a stable order — sorted by name, so an invented
  // category doesn't recolour the others just by appearing — and skip colours
  // already claimed in categories.yml so two categories don't come out
  // matching. Only if the palette runs out do colours start repeating.
  const claimed = new Set(categoryColours.values());
  const available = COLOUR_ROTATION.filter((colour) => !claimed.has(colour));
  const palette = available.length ? available : COLOUR_ROTATION;

  unpinned.sort();
  for (const category of categories) {
    if (category.colour) continue;
    const position = unpinned.indexOf(category.name.toLowerCase());
    category.colour = palette[position % palette.length];
  }

  return categories.sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'en')
  );
}

function buildContributors(clubs, { contributorOrder }) {
  const found = new Map();

  for (const club of clubs) {
    for (const contribution of club.contributions) {
      for (const name of contribution.contributors) {
        const key = name.toLowerCase();
        if (!found.has(key)) found.set(key, { name, clubs: [], contributionCount: 0 });
        const entry = found.get(key);
        entry.contributionCount += 1;
        if (!entry.clubs.includes(club)) entry.clubs.push(club);
      }
    }
  }

  return [...found.entries()]
    .map(([key, entry]) => ({
      ...entry,
      slug: slugify(entry.name),
      order: contributorOrder.has(key) ? contributorOrder.get(key) : Number.MAX_SAFE_INTEGER,
      count: entry.clubs.length,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'en'));
}

export default function () {
  if (!fs.existsSync(CLUBS_DIR)) {
    console.warn(
      `[clubs] No ${CLUBS_DIR} folder. Run scripts/fetch-content.sh, or set ` +
        `HHC_CONTENT_DIR to a local checkout of HalfHourClub_Content.`
    );
    return {
      all: [],
      categories: [],
      contributors: [],
      calendarDays: {},
      colourByCategory: {},
    };
  }

  const config = loadConfig();

  const all = fs
    .readdirSync(CLUBS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => readClub(entry.name, config.aliases))
    .filter(Boolean)
    // Newest first: that's the order the home page and every list page wants.
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'en'));

  // Keyed by day for the calendar. A day can hold more than one club, so the
  // value is always a list.
  const byDate = {};
  for (const club of all) {
    (byDate[club.date] ??= []).push(club);
  }

  const categories = buildCategories(all, config);
  const contributorList = buildContributors(all, config);

  return {
    all,
    categories,
    contributors: contributorList,
    /** Category name → pastel colour, so a template can tint a chip by name. */
    colourByCategory: Object.fromEntries(categories.map((c) => [c.name, c.colour])),

    /**
     * A deliberately thin payload for the /new/ form's inline config.
     *
     * The full `all`/`categories` structures carry every contribution's
     * rendered HTML, and categories repeat whole club objects — inlining those
     * would add hundreds of kilobytes to /new/ for no benefit. The form only
     * needs names to populate its dropdowns and a list to pick from when
     * editing.
     */
    formData: {
      /*
       * Union of what's configured and what's in use, config order first. A
       * category listed in categories.yml but not yet used still needs to be
       * offered, and one someone invented on the spot needs to stay offered.
       * The browsing chips on the home page deliberately don't do this — an
       * empty category page would be nothing to look at.
       */
      categories: [
        ...new Set([
          ...config.configuredCategories,
          ...categories.map((category) => category.name),
        ]),
      ],
      contributors: [
        ...new Set([
          ...config.configuredContributors,
          ...contributorList.map((contributor) => contributor.name),
        ]),
      ],
      clubs: all.map((club) => ({
        slug: club.slug,
        title: club.title,
        date: club.date,
        dateLabel: club.dateLabel,
      })),
    },
    // Fed to the calendar as inline JSON — see src/_includes/base.njk for why
    // this must never become a separate .json file.
    calendarDays: Object.fromEntries(
      Object.entries(byDate).map(([date, clubsOnDay]) => [
        date,
        clubsOnDay.map((club) => ({ title: club.title, url: club.url })),
      ])
    ),
    earliest: all.length ? all[all.length - 1].date : null,
    latest: all.length ? all[0].date : null,
    monthOfLatest: all.length ? all[0].date.slice(0, 7) : null,
  };
}
