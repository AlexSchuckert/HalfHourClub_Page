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

const auth = (await import('../netlify/functions/auth.mjs')).default;
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
