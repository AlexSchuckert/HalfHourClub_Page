/**
 * The two Netlify functions, exercised directly. They use the standard
 * Request/Response API, so they can be called without deploying anything.
 *
 * Everything here is the gate in front of GitHub: if the publish-key check is
 * wrong, the content repo is writable by anyone who finds the URL. Nothing
 * reaches GitHub in this test — the credentials are deliberately absent.
 *
 *   node test/functions.test.mjs
 */

const KEY = 'test-publish-key-0123456789';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

process.env.HHC_PUBLISH_KEY = KEY;
// Left unset on purpose, so a correct key gets as far as GitHub and no further.
delete process.env.HHC_GH_APP_ID;
delete process.env.HHC_GH_APP_PRIVATE_KEY;
delete process.env.HHC_GH_APP_INSTALLATION_ID;

const authModule = await import('../netlify/functions/auth.mjs');
const auth = authModule.default;
const { resolveBranch } = authModule;
const geocode = (await import('../netlify/functions/geocode.mjs')).default;

const post = (body) =>
  new Request('https://example.test/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const read = async (response) => ({ status: response.status, body: await response.json() });

console.log('\nAUTH FUNCTION');

let out = await read(await auth(new Request('https://example.test/api/auth')));
check('GET is refused', out.status === 405, `${out.status} ${out.body.error}`);

out = await read(await auth(post('not json at all')));
check('Malformed body is refused', out.status === 400, `${out.status} ${out.body.error}`);

out = await read(await auth(post({})));
check('Missing key is refused', out.status === 401, `${out.status} ${out.body.error}`);

out = await read(await auth(post({ key: 'wrong' })));
check('Wrong key is refused', out.status === 401, `${out.status} ${out.body.error}`);

// A prefix of the real key must not be accepted — the length check has to come
// before timingSafeEqual, which throws on mismatched lengths.
out = await read(await auth(post({ key: KEY.slice(0, -1) })));
check('A prefix of the key is refused', out.status === 401, `${out.status} ${out.body.error}`);

out = await read(await auth(post({ key: `${KEY}x` })));
check('The key plus a character is refused', out.status === 401, `${out.status}`);

out = await read(await auth(post({ key: 12345 })));
check('A non-string key is refused', out.status === 401, `${out.status}`);

// The right key gets through the gate and fails at GitHub, which is as far as
// it can go without credentials — proving the gate itself opened.
out = await read(await auth(post({ key: KEY })));
check(
  'The right key passes the gate',
  out.status === 502 && /Missing environment variable/.test(out.body.error),
  `${out.status} ${out.body.error}`
);

// Unconfigured server: say so, rather than pretending the caller is at fault.
delete process.env.HHC_PUBLISH_KEY;
out = await read(await auth(post({ key: KEY })));
check('Unset publish key reports misconfiguration', out.status === 503, `${out.status} ${out.body.error}`);
process.env.HHC_PUBLISH_KEY = KEY;

console.log('\nBRANCH RESOLUTION');

/*
 * The bug this guards against: the branch used to be hardcoded to "main". A repo
 * whose first push was a feature branch has no main — GitHub makes that branch
 * the default — so `git clone` in the build got the right files while the form's
 * API calls 404'd on a branch that didn't exist.
 */
const realFetch = globalThis.fetch;
const stubFetch = (body, ok = true, status = 200) => {
  globalThis.fetch = async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
};

try {
  delete process.env.HHC_CONTENT_BRANCH;

  stubFetch({ default_branch: 'main' });
  check('Follows a default branch of main', (await resolveBranch('t', 'o/r')) === 'main');

  // Exactly the situation on the real repo right now.
  stubFetch({ default_branch: 'claude/half-hour-club-webpage-r37l6y' });
  check(
    'Follows a default branch that is not main',
    (await resolveBranch('t', 'o/r')) === 'claude/half-hour-club-webpage-r37l6y'
  );

  stubFetch({ default_branch: 'master' });
  check('Follows a default branch of master', (await resolveBranch('t', 'o/r')) === 'master');

  process.env.HHC_CONTENT_BRANCH = 'pinned-branch';
  stubFetch({ default_branch: 'main' });
  check(
    'HHC_CONTENT_BRANCH overrides the default',
    (await resolveBranch('t', 'o/r')) === 'pinned-branch'
  );
  delete process.env.HHC_CONTENT_BRANCH;

  // An override should not need a network call at all.
  process.env.HHC_CONTENT_BRANCH = 'offline-branch';
  globalThis.fetch = async () => {
    throw new Error('should not have been called');
  };
  check(
    'An override skips the lookup entirely',
    (await resolveBranch('t', 'o/r')) === 'offline-branch'
  );
  delete process.env.HHC_CONTENT_BRANCH;

  // App not installed on the repo → GitHub answers 404, and the message should
  // point at the actual cause rather than at a missing branch.
  stubFetch({ message: 'Not Found' }, false, 404);
  try {
    await resolveBranch('t', 'o/r');
    check('An unreadable repo is reported clearly', false, 'it succeeded');
  } catch (error) {
    check(
      'An unreadable repo is reported clearly',
      /GitHub App is installed/.test(error.message),
      error.message
    );
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log('\nGEOCODE FUNCTION');

const geoPost = (body) =>
  new Request('https://example.test/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

out = await read(await geocode(new Request('https://example.test/api/geocode')));
check('GET is refused', out.status === 405, `${out.status}`);

out = await read(await geocode(geoPost({ key: 'wrong', latitude: 0, longitude: 0 })));
check('Wrong key is refused (no open proxy)', out.status === 401, `${out.status}`);

out = await read(await geocode(geoPost({ key: KEY, latitude: 'north', longitude: 0 })));
check('Non-numeric coordinates refused', out.status === 400, `${out.status} ${out.body.error}`);

out = await read(await geocode(geoPost({ key: KEY, latitude: 91, longitude: 0 })));
check('Out-of-range latitude refused', out.status === 400, `${out.status}`);

out = await read(await geocode(geoPost({ key: KEY, latitude: 0, longitude: 181 })));
check('Out-of-range longitude refused', out.status === 400, `${out.status}`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
