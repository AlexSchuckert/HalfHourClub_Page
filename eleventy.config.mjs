/**
 * Eleventy configuration.
 *
 * Input is src/ (templates and assets); the club archive is read separately by
 * src/_data/clubs.js out of ./content, which scripts/fetch-content.sh puts
 * there before this runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { dateLabel, timeLabel } from './lib/dates.mjs';

const CLUBS_DIR = 'content/clubs';

/**
 * Copy each club's media folder to its published location.
 *
 * This is done club by club, from an explicit list, rather than with one broad
 * `content/clubs → clubs` passthrough. That matters: a broad copy would also
 * publish club.md and the contribution markdown as plain files, and StatiCrypt
 * only encrypts .html — so the entire archive would be readable without the
 * password. Only media is ever copied out.
 */
function passthroughClubMedia(eleventyConfig) {
  if (!fs.existsSync(CLUBS_DIR)) return;

  for (const entry of fs.readdirSync(CLUBS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const mediaDir = path.join(CLUBS_DIR, entry.name, 'media');
    if (fs.existsSync(mediaDir)) {
      eleventyConfig.addPassthroughCopy({ [mediaDir]: `clubs/${entry.name}/media` });
    }
  }
}

export default function (eleventyConfig) {
  // --- Static assets -------------------------------------------------------
  eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' });

  // Self-hosted fonts. Serving these ourselves rather than from Google means no
  // third-party request on a private family site, and no round-trip before text
  // can paint (the same reasoning that made the mooring wiki set `font: false`).
  eleventyConfig.addPassthroughCopy({
    'node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff2':
      'assets/fonts/eb-garamond-400.woff2',
    'node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff2':
      'assets/fonts/eb-garamond-400-italic.woff2',
    'node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff2':
      'assets/fonts/eb-garamond-600.woff2',
    'node_modules/@fontsource/fraunces/files/fraunces-latin-500-normal.woff2':
      'assets/fonts/fraunces-500.woff2',
    'node_modules/@fontsource/fraunces/files/fraunces-latin-700-normal.woff2':
      'assets/fonts/fraunces-700.woff2',
  });

  // Vendored libraries used only by /new/. The two big ones are imported
  // lazily by the code that needs them, so nobody who is just reading poems
  // downloads either: mediabunny (630 KB) only when a video is dropped, and the
  // HEIC decoder (2.9 MB) only when a browser that can't read HEIC meets one.
  //
  // Self-hosted rather than pulled from a CDN: no third-party request from a
  // private family archive, and the site keeps working if a CDN doesn't.
  eleventyConfig.addPassthroughCopy({
    'node_modules/easymde/dist/easymde.min.js': 'assets/vendor/easymde.min.js',
    'node_modules/easymde/dist/easymde.min.css': 'assets/vendor/easymde.min.css',
    'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs':
      'assets/vendor/mediabunny.min.mjs',
    // The "csp" build avoids unsafe-eval.
    'node_modules/heic-to/dist/csp/heic-to.min.js': 'assets/vendor/heic-to.min.js',
  });

  passthroughClubMedia(eleventyConfig);

  // --- Filters -------------------------------------------------------------
  eleventyConfig.addFilter('dateLabel', dateLabel);
  eleventyConfig.addFilter('timeLabel', timeLabel);

  /**
   * Inline JSON for the calendar and the publishing form's dropdowns.
   *
   * `</script>` inside a JSON string would end the script element early, and a
   * lone U+2028/U+2029 is a syntax error in older parsers — escape both.
   */
  eleventyConfig.addFilter('inlineJson', (value) =>
    JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
  );

  eleventyConfig.addFilter('take', (array, count) => (array ?? []).slice(0, count));

  // Rebuild the site when the fetched content changes, not just when a template does.
  eleventyConfig.addWatchTarget('content/');

  return {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      data: '_data',
    },
    templateFormats: ['njk', 'md'],
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
  };
}
