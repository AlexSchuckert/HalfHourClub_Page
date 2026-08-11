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
 * Used three ways:
 *   import { mintInstallationToken } from './gh-app-token.mjs'
 *   node scripts/gh-app-token.mjs           # prints a token on stdout
 *   node scripts/gh-app-token.mjs --check   # checks the key parses, calls nothing
 *
 * Required environment variables:
 *   HHC_GH_APP_ID               the App's numeric ID
 *   HHC_GH_APP_PRIVATE_KEY      the App's private key (see loadPrivateKey below)
 *   HHC_GH_APP_INSTALLATION_ID  the installation on HalfHourClub_Content
 */

import { createSign, createPrivateKey } from 'node:crypto';

const b64url = (input) => Buffer.from(input).toString('base64url');

/** Re-wrap a base64 body at 64 characters, as PEM requires. */
const wrapBase64 = (body) => body.match(/.{1,64}/g)?.join('\n') ?? '';

/** Everything that isn't base64 — whitespace, stray punctuation. */
const stripToBase64 = (text) => text.replace(/[^A-Za-z0-9+/=]/g, '');

/**
 * Build the PEM forms worth trying, from however the key actually arrived.
 *
 * A GitHub App private key is a multi-line PEM, and Netlify's environment
 * variable field is single-line — so by the time it reaches us the newlines
 * have often become spaces, or literal "\n", or been dropped altogether. Any
 * of those produce the same opaque OpenSSL complaint:
 *
 *     error:1E08010C:DECODER routines::unsupported
 *
 * which reads like a Node or OpenSSL version problem and isn't one: the key is
 * simply no longer a valid PEM. Rather than make that someone's afternoon, we
 * reconstruct the file from whatever survived.
 */
function pemCandidates(raw) {
  let text = String(raw).trim();

  // Pasted with surrounding quotes.
  if (/^(["']).*\1$/s.test(text)) text = text.slice(1, -1).trim();

  // Literal backslash-n (JSON-style escaping), and CRLF line endings.
  text = text.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r\n?/g, '\n');

  // The normal case, plus every case where the body's newlines were mangled:
  // take the label and the base64 between the markers and rebuild the file.
  const withMarkers = text.match(/-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/);
  if (withMarkers) {
    const [, label, body] = withMarkers;
    return [`-----BEGIN ${label}-----\n${wrapBase64(stripToBase64(body))}\n-----END ${label}-----\n`];
  }

  // A whole PEM that was base64-encoded to survive the trip. This is the
  // sturdiest way to store it in a single-line field — see the README.
  const compact = stripToBase64(text);
  if (compact.length > 100) {
    let decoded = '';
    try {
      decoded = Buffer.from(compact, 'base64').toString('utf8');
    } catch {
      // Not base64 of anything textual; fall through.
    }
    if (decoded.includes('-----BEGIN')) return pemCandidates(decoded);

    // Bare base64 DER with the markers lost entirely. We can't tell PKCS#1
    // from PKCS#8 by looking, so offer both and let the parser decide.
    const wrapped = wrapBase64(compact);
    return [
      `-----BEGIN RSA PRIVATE KEY-----\n${wrapped}\n-----END RSA PRIVATE KEY-----\n`,
      `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`,
    ];
  }

  return [];
}

/**
 * Turn the environment variable into a usable key, or explain what's wrong.
 *
 * The diagnostics deliberately describe only the *shape* of the value — its
 * length, whether the BEGIN/END markers survived — and never any of its
 * content, so a failing build log can't leak the key.
 *
 * @returns {import('node:crypto').KeyObject}
 */
export function loadPrivateKey(raw) {
  if (!raw || !String(raw).trim()) {
    throw new Error('HHC_GH_APP_PRIVATE_KEY is empty.');
  }

  const candidates = pemCandidates(raw);
  let lastError = null;

  for (const pem of candidates) {
    try {
      return createPrivateKey(pem);
    } catch (error) {
      lastError = error;
    }
  }

  const text = String(raw);
  const shape = [
    `${text.length} characters`,
    text.includes('-----BEGIN') ? 'has a BEGIN marker' : 'no BEGIN marker',
    text.includes('-----END') ? 'has an END marker' : 'no END marker',
    text.includes('\n') ? 'contains real newlines' : 'is a single line',
    text.includes('\\n') ? 'contains literal \\n' : null,
  ]
    .filter(Boolean)
    .join(', ');

  throw new Error(
    `HHC_GH_APP_PRIVATE_KEY could not be read as a private key.\n` +
      `  What arrived: ${shape}.\n` +
      `  ${lastError ? `OpenSSL said: ${lastError.message.split('\n')[0]}\n  ` : ''}` +
      `This is almost always the PEM being flattened by a single-line settings ` +
      `field, not a problem with the key itself. The most reliable fix is to ` +
      `store it base64-encoded — run:\n` +
      `      base64 -w0 your-app-key.pem\n` +
      `  (on macOS: base64 -i your-app-key.pem)\n` +
      `  and paste that single line as the value. This script decodes it ` +
      `automatically.`
  );
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
  return `${header}.${payload}.${b64url(signer.sign(loadPrivateKey(privateKey)))}`;
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

// Run directly. `--check` validates the credentials without calling GitHub —
// useful for testing a Netlify value locally before redeploying. Otherwise
// print the token and nothing else, so shell scripts can capture it with $(...).
if (import.meta.url === `file://${process.argv[1]}`) {
  const checkOnly = process.argv.includes('--check');
  try {
    if (checkOnly) {
      const key = loadPrivateKey(process.env.HHC_GH_APP_PRIVATE_KEY);
      process.stderr.write(
        `Private key reads correctly (${key.asymmetricKeyType}, ` +
          `${key.asymmetricKeyDetails?.modulusLength ?? '?'} bits).\n` +
          `App ID: ${process.env.HHC_GH_APP_ID ? 'set' : 'MISSING'}, ` +
          `installation ID: ${process.env.HHC_GH_APP_INSTALLATION_ID ? 'set' : 'MISSING'}\n`
      );
    } else {
      const { token } = await mintInstallationToken();
      process.stdout.write(token);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
