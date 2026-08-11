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

const CONTENT_REPO = () => process.env.HHC_CONTENT_REPO || 'AlexSchuckert/HalfHourClub_Content';

/**
 * Which branch the form should read and write.
 *
 * Do NOT assume "main". A freshly created repo whose first push was a feature
 * branch has no main at all, and GitHub makes that first branch the default —
 * at which point the build (scripts/fetch-content.sh runs `git clone`, which
 * checks out the default branch) and the publishing form would be looking at
 * two different places. Hardcoding "main" here is what produced
 *
 *     GitHub said 404 … /rest/git/refs#get-a-reference
 *
 * on save while the site itself built perfectly. Asking the repo for its own
 * default branch keeps the two in step by construction, whatever it's called.
 *
 * `HHC_CONTENT_BRANCH` overrides, for pinning to a branch that isn't default.
 */
export async function resolveBranch(token, repo) {
  if (process.env.HHC_CONTENT_BRANCH) return process.env.HHC_CONTENT_BRANCH;

  const response = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HalfHourClub-Site',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Could not read ${repo} (${response.status}). Check that the GitHub App ` +
        `is installed on that repository.`
    );
  }

  const { default_branch: defaultBranch } = await response.json();
  return defaultBranch || 'main';
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
    const repo = CONTENT_REPO();
    return reply(200, {
      token,
      expiresAt,
      repo,
      branch: await resolveBranch(token, repo),
    });
  } catch (error) {
    // The message can name a missing env var, which is useful and not secret.
    // It never contains the private key itself.
    console.error('Could not mint an installation token:', error.message);
    return reply(502, { error: `GitHub would not issue a token: ${error.message}` });
  }
}
