/**
 * Site-wide settings, plus the two values the publishing form needs.
 *
 * `publishKey` is read from the environment at build time and rendered into
 * /new/index.html. That is safe *only* because scripts/build.sh encrypts every
 * page afterwards: the key sits inside the AES ciphertext, so it's readable
 * just to someone who already typed the family password. Never put it on any
 * other page, and never write it to a separate file — StatiCrypt only encrypts
 * .html.
 */

export default {
  title: 'Half Hour Club',
  tagline: 'Thirty minutes, one prompt, whatever we make',

  publishKey: process.env.HHC_PUBLISH_KEY || '',

  /*
   * Which repo and branch the form writes to is deliberately NOT here.
   * netlify/functions/auth.mjs returns both with the token, reading the branch
   * from the repository's own default — so the form always writes where
   * scripts/fetch-content.sh reads. A second copy in this file could drift out
   * of step, which is exactly the bug that made saving 404 while the site built
   * fine.
   */
};
