/**
 * POST /api/auth — the only thing standing between the publishing form and the
 * content repo.
 *
 * The form sends the publish key that was baked into /new/index.html at build
 * time. Because scripts/build.sh encrypts every page with the family password,
 * that key is only readable to someone who already got past the gate — so
 * "knows the publish key" means "knows the family password", and the family
 * only ever needs the one secret you asked for.
 *
 * In return the form gets a GitHub App installation token: valid for an hour,
 * limited to Contents on HalfHourClub_Content. The browser then talks to GitHub
 * directly, which it has to — Netlify caps a function's request body at 6 MB and
 * a compressed video can be 50 MB.
 *
 * Environment variables (Netlify dashboard, never git):
 *   HHC_PUBLISH_KEY
 *   HHC_GH_APP_ID, HHC_GH_APP_PRIVATE_KEY, HHC_GH_APP_INSTALLATION_ID
 */

import { timingSafeEqual } from 'node:crypto';
import { mintInstallationToken } from '../../scripts/gh-app-token.mjs';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS,
});

/**
 * Compare without leaking how much of the key matched through timing.
 * Lengths are compared first because timingSafeEqual throws on a mismatch —
 * key length isn't a secret worth protecting.
 */
function keyMatches(candidate, expected) {
  if (typeof candidate !== 'string' || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return reply(405, { error: 'Use POST.' });
  }

  const expectedKey = process.env.HHC_PUBLISH_KEY;
  if (!expectedKey) {
    // Misconfiguration, not a rejected caller — say so plainly so whoever set
    // the site up can fix it, without hinting at anything secret.
    return reply(503, {
      error: 'Publishing is not configured: HHC_PUBLISH_KEY is unset on the server.',
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return reply(400, { error: 'Expected a JSON body.' });
  }

  if (!keyMatches(payload?.key, expectedKey)) {
    return reply(401, { error: 'Not authorised.' });
  }

  try {
    const { token, expiresAt } = await mintInstallationToken();
    return reply(200, {
      token,
      expiresAt,
      repo: process.env.HHC_CONTENT_REPO || 'AlexSchuckert/HalfHourClub_Content',
      branch: process.env.HHC_CONTENT_BRANCH || 'main',
    });
  } catch (error) {
    // The message can name a missing env var, which is useful and not secret.
    // It never contains the private key itself.
    console.error('Could not mint an installation token:', error.message);
    return reply(502, { error: `GitHub would not issue a token: ${error.message}` });
  }
}
