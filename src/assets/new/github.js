/**
 * Talking to GitHub: get a token, read a club, write a club, delete a club.
 *
 * Everything a save touches goes into ONE commit, built with the git data API
 * (blobs → tree → commit → move the branch). That matters for two reasons:
 * a push is what triggers the site rebuild, so N files committed separately
 * would mean N rebuilds; and a half-written club never appears, because the
 * branch only moves once every file is already stored.
 */

const API = 'https://api.github.com';

/** Cached so a session doesn't ask for a new token on every save. */
let cachedToken = null;

/**
 * Swap the publish key — which was baked into this page and is therefore only
 * readable to someone who typed the family password — for a GitHub token that
 * expires in an hour.
 */
export async function getToken(publishKey) {
  // Renew a minute early rather than risk a request racing the expiry.
  if (cachedToken && Date.parse(cachedToken.expiresAt) - Date.now() > 60_000) {
    return cachedToken;
  }

  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: publishKey }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `Could not get permission to publish (${response.status}).`);
  }

  cachedToken = body;
  return cachedToken;
}

async function gh(token, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await explainFailure(response, path));
  }

  return response.status === 204 ? null : response.json();
}

/**
 * Turn a GitHub error into something worth reading.
 *
 * A bare "GitHub said 404" sends you to the wrong place: GitHub answers 404
 * rather than 403 for anything a token can't see, so the same status covers a
 * missing branch, a repo the App isn't installed on, and a genuine typo. Name
 * which call failed and what the likely causes are.
 */
async function explainFailure(response, path) {
  const detail = (await response.text().catch(() => '')).slice(0, 200);
  const what = path.replace(/^\/repos\/[^/]+\/[^/]+/, '');

  if (response.status === 404) {
    return (
      `GitHub couldn't find ${what} (404). Usually one of:\n` +
      `• the branch doesn't exist in the archive repository\n` +
      `• the GitHub App isn't installed on that repository\n` +
      `• the club was renamed or deleted since this page loaded`
    );
  }

  if (response.status === 401 || response.status === 403) {
    return (
      `GitHub refused the request (${response.status}) for ${what}. The publishing ` +
      `token may have expired — reload the page and try again.`
    );
  }

  if (response.status === 409 || response.status === 422) {
    return (
      `GitHub rejected the change (${response.status}) for ${what}. Someone may have ` +
      `edited the archive at the same moment — reload and redo the change. ${detail}`
    );
  }

  return `GitHub said ${response.status} for ${what}: ${detail}`;
}

/** Binary → base64, in chunks so a 50 MB video doesn't blow the call stack. */
async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * Commit a set of files, and optionally delete a set of paths, in one go.
 *
 * @param {object} auth        {token, repo, branch} from getToken()
 * @param {Array}  files       [{path, content}] with content a string or Blob,
 *                             or [{path, sha}] to point at a blob that is
 *                             already in the repo — which is how media survives
 *                             a club being renamed without re-uploading it
 * @param {string} message     commit message
 * @param {string[]} deletions paths to remove
 * @param {(message: string) => void} onProgress
 */
export async function commitFiles(auth, { files = [], deletions = [], message, onProgress = () => {} }) {
  const { token, repo, branch } = auth;

  onProgress('Checking the archive…');
  const ref = await gh(token, `/repos/${repo}/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const headCommit = await gh(token, `/repos/${repo}/git/commits/${headSha}`);

  // Upload each file as a blob first. Text goes as UTF-8, media as base64 —
  // the API needs to be told which.
  const tree = [];
  let done = 0;

  for (const file of files) {
    done += 1;

    // Already a blob in the repo (a moved file): reuse the sha, upload nothing.
    if (file.sha) {
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: file.sha });
      continue;
    }

    onProgress(`Uploading ${done} of ${files.length}: ${file.path.split('/').pop()}`);

    const isText = typeof file.content === 'string';
    const blob = await gh(token, `/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify(
        isText
          ? { content: file.content, encoding: 'utf-8' }
          : { content: await toBase64(file.content), encoding: 'base64' }
      ),
    });

    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // A null sha in a tree entry is how the git API spells "remove this path".
  for (const path of deletions) {
    tree.push({ path, mode: '100644', type: 'blob', sha: null });
  }

  if (!tree.length) throw new Error('Nothing to save.');

  onProgress('Saving…');
  const newTree = await gh(token, `/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
  });

  const commit = await gh(token, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
  });

  // Only now does anything become visible — and this is the push that triggers
  // the rebuild.
  await gh(token, `/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });

  return commit;
}

/** Every file under a club folder, so the editor can load and diff it. */
export async function listClubFiles(auth, slug) {
  const { token, repo, branch } = auth;
  const tree = await gh(
    token,
    `/repos/${repo}/git/trees/${branch}?recursive=1`
  );

  const prefix = `clubs/${slug}/`;
  return tree.tree
    .filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix))
    .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size }));
}

/** Read one text file out of the content repo. */
export async function readTextFile(auth, path) {
  const { token, repo, branch } = auth;
  const file = await gh(
    token,
    `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${branch}`
  );

  // The contents API base64-encodes; decode as UTF-8 so accents survive.
  const binary = atob(file.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
