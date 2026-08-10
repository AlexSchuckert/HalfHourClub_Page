/**
 * Turn contributed markdown into safe HTML.
 *
 * SECURITY — why this file matters
 * -------------------------------
 * Anyone with the family password can write to the content repo through the
 * publishing form. Markdown normally lets you embed raw HTML, so without this
 * step a contribution could contain a <script> that runs in every reader's
 * browser. That would be worse here than on an ordinary site: the script could
 * read StatiCrypt's derived key out of localStorage, decrypt /new/ and lift the
 * publish key. So content is locked down twice over:
 *
 *   1. markdown-it runs with `html: false` — raw HTML in a contribution is
 *      escaped into visible text, never parsed as markup.
 *   2. The rendered output goes through sanitize-html's allowlist anyway, which
 *      strips anything executable and enforces which attributes may survive.
 *
 * Both layers live in THIS repo, which the publishing form cannot write to —
 * that is what makes "contributors can write words but not code" actually
 * enforceable, exactly as mooring_wiki/scripts/sanitize_hook.py does for the
 * wiki.
 */

import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'oga', 'ogg', 'flac'];

const markdown = new MarkdownIt({
  html: false, // see note above — raw HTML is escaped, not parsed
  linkify: true,
  typographer: true, // curly quotes and proper dashes suit the serif type
  breaks: true, // a single newline becomes <br>, which poetry depends on
});

/**
 * Tags a contribution may use. Deliberately absent: script, style, iframe,
 * object, embed, form, input, svg, link, meta — anything that can execute or
 * pull in active content. `details`/`summary` are allowed so a contributor can
 * nest their own spoiler if they want to.
 */
const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'del', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's',
  'samp', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul', 'details', 'summary',
];

const SANITIZE_OPTIONS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    '*': ['class', 'title', 'dir', 'lang'],
    a: ['href', 'name'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    td: ['align', 'colspan', 'rowspan'],
    th: ['align', 'colspan', 'rowspan', 'scope'],
    ol: ['start'],
    details: ['open'],
  },
  // javascript:, data: and vbscript: URLs cannot survive this.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  // Outbound links open safely.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

const extensionOf = (path) => (path.split('.').pop() || '').toLowerCase().split(/[?#]/)[0];

/**
 * Contributions reference their files relatively — `media/7f3a9c21.jpg` — so a
 * club folder stays self-contained and can be moved or renamed. Point them at
 * the published location instead.
 */
function rewriteMediaPaths(html, clubUrl) {
  return html.replace(
    /(src|href)="\.?\/?media\/([^"]+)"/g,
    (_match, attribute, file) => `${attribute}="${clubUrl}media/${file}"`
  );
}

/**
 * Markdown has no syntax for video, so a dropped clip is written with image
 * syntax — `![Ella dancing](media/clip.mp4)` — and upgraded to a real player
 * here. Doing the swap at build time means the sanitiser above can stay strict:
 * contributions never need permission to write <video> themselves.
 *
 * The regex is safe to use here because it only ever sees markdown-it's own
 * output, already sanitised — not arbitrary hand-written HTML.
 */
function upgradeMediaElements(html) {
  return html.replace(
    /<img\s+src="([^"]+)"(?:\s+alt="([^"]*)")?[^>]*>/g,
    (match, src, alt = '') => {
      const extension = extensionOf(src);
      const caption = alt ? `<span class="media-caption">${alt}</span>` : '';

      if (VIDEO_EXTENSIONS.includes(extension)) {
        return (
          `<span class="media media-video">` +
          `<video controls preload="metadata" playsinline src="${src}"` +
          (alt ? ` aria-label="${alt}"` : '') +
          `></video>${caption}</span>`
        );
      }

      if (AUDIO_EXTENSIONS.includes(extension)) {
        return (
          `<span class="media media-audio">` +
          `<audio controls preload="metadata" src="${src}"` +
          (alt ? ` aria-label="${alt}"` : '') +
          `></audio>${caption}</span>`
        );
      }

      // Images keep their <img>, tagged so the lightbox can find them.
      return match.replace('<img ', '<img class="media-image" loading="lazy" ');
    }
  );
}

/**
 * The full pipeline: markdown → safe HTML → published media paths → players.
 *
 * @param {string} source   markdown from the content repo
 * @param {string} clubUrl  the club's URL, e.g. "/clubs/2026-08-10-jesus-and-cicadas/"
 */
export function renderContent(source, clubUrl) {
  if (!source || !source.trim()) return '';
  const rendered = markdown.render(source);
  const safe = sanitizeHtml(rendered, SANITIZE_OPTIONS);
  return upgradeMediaElements(rewriteMediaPaths(safe, clubUrl));
}

