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

  /** The content repo the publishing form writes to. */
  contentRepo: 'AlexSchuckert/HalfHourClub_Content',
  contentBranch: 'main',

  publishKey: process.env.HHC_PUBLISH_KEY || '',

};
