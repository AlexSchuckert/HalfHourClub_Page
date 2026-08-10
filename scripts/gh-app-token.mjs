/**
 * Mint a short-lived GitHub App installation token for the content repo.
 *
 * Why a GitHub App rather than a personal access token: the token this returns
 * expires after one hour and is scoped to the single repo the App is installed
 * on. The browser publishing form receives one of these (see
 * netlify/functions/auth.mjs), so no long-lived credential ever sits in
 * anyone's browser — and there is nothing to renew every year.
 *
 * This is the ONLY machine credential in the system. The build uses it too
 * (scripts/fetch-content.sh) to read the content repo, which is why there's no
 * separate read-only token to look after.
 *
 * Used two ways:
 *   import { mintInstallationToken } from './gh-app-token.mjs'
 *   node scripts/gh-app-token.mjs           # prints a token on stdout
 *
 * Required environment variables:
 *   HHC_GH_APP_ID               the App's numeric ID
 *   HHC_GH_APP_PRIVATE_KEY      the App's private key, PEM format
 *   HHC_GH_APP_INSTALLATION_ID  the installation on HalfHourClub_Content
 */

import { createSign } from 'node:crypto';

const b64url = (input) => Buffer.from(input).toString('base64url');

/**
 * Netlify's environment variables are single-line, so a pasted PEM usually
 * arrives with literal backslash-n instead of real newlines. Accept either.
 */
function normalisePrivateKey(key) {
  const pem = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
  return pem.trim() + '\n';
}

/**
 * A JWT signed with the App's private key. This authenticates us *as the App*,
 * which is only good for asking GitHub for an installation token. GitHub caps
 * its lifetime at 10 minutes; we ask for 9, and backdate `iat` by a minute so
 * a slightly fast clock doesn't get the token rejected.
 */
function appJwt({ appId, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${b64url(signer.sign(normalisePrivateKey(privateKey)))}`;
}

/**
 * Exchange the App JWT for an installation token.
 *
 * `permissions` is narrowed to contents-only even though the App itself should
 * only have that permission — belt and braces, so a mis-configured App can't
 * hand out more than the form needs.
 *
 * @returns {Promise<{token: string, expiresAt: string}>}
 */
export async function mintInstallationToken({
  appId = process.env.HHC_GH_APP_ID,
  privateKey = process.env.HHC_GH_APP_PRIVATE_KEY,
  installationId = process.env.HHC_GH_APP_INSTALLATION_ID,
} = {}) {
  const missing = Object.entries({
    HHC_GH_APP_ID: appId,
    HHC_GH_APP_PRIVATE_KEY: privateKey,
    HHC_GH_APP_INSTALLATION_ID: installationId,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt({ appId, privateKey })}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'HalfHourClub-Site',
      },
      body: JSON.stringify({ permissions: { contents: 'write' } }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `GitHub refused to mint an installation token (${response.status}): ${detail}`
    );
  }

  const { token, expires_at: expiresAt } = await response.json();
  return { token, expiresAt };
}

// Run directly (`node scripts/gh-app-token.mjs`) → print the token, nothing else,
// so shell scripts can capture it with $(...).
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { token } = await mintInstallationToken();
    process.stdout.write(token);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
