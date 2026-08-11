/**
 * The GitHub App private key has to survive being pasted into a single-line
 * settings field. Every mangling below has been seen in the wild, and each one
 * used to fail with the same misleading OpenSSL error:
 *
 *     error:1E08010C:DECODER routines::unsupported
 *
 * which looks like a Node or OpenSSL version problem but isn't — the PEM had
 * simply stopped being a valid PEM. These check that loadPrivateKey copes.
 *
 *   node test/private-key.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { createSign, createVerify, createPublicKey } from 'node:crypto';
import { loadPrivateKey } from '../scripts/gh-app-token.mjs';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** GitHub issues PKCS#1 keys ("BEGIN RSA PRIVATE KEY"). */
const pkcs1 = execFileSync('openssl', ['genrsa', '-traditional', '2048'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const pkcs8 = execFileSync('openssl', ['pkcs8', '-topk8', '-nocrypt'], {
  input: pkcs1,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'ignore'],
});

/** A key is only really usable if it can sign something verifiable. */
function signsCorrectly(raw, reference) {
  const key = loadPrivateKey(raw);
  const signer = createSign('RSA-SHA256');
  signer.update('half hour club');
  signer.end();
  const signature = signer.sign(key);

  const verifier = createVerify('RSA-SHA256');
  verifier.update('half hour club');
  verifier.end();
  return verifier.verify(createPublicKey(reference), signature);
}

const manglings = {
  'PKCS#1, pristine': pkcs1,
  'PKCS#8, pristine': pkcs8,
  'literal backslash-n': pkcs1.replace(/\n/g, '\\n'),
  'CRLF line endings': pkcs1.replace(/\n/g, '\r\n'),
  'newlines collapsed to spaces': pkcs1.replace(/\n/g, ' '),
  'all newlines stripped': pkcs1.replace(/\n/g, ''),
  'wrapped in double quotes': JSON.stringify(pkcs1),
  'wrapped in single quotes': `'${pkcs1}'`,
  'leading and trailing whitespace': `   \n${pkcs1}\n   `,
  'tabs instead of newlines': pkcs1.replace(/\n/g, '\t'),
  'headers lost, body only (PKCS#1)': pkcs1.split('\n').slice(1, -2).join('\n'),
  'headers lost, body only (PKCS#8)': pkcs8.split('\n').slice(1, -2).join('\n'),
  'whole PEM base64-encoded': Buffer.from(pkcs1).toString('base64'),
  'base64-encoded with line breaks': Buffer.from(pkcs1).toString('base64').match(/.{1,76}/g).join('\n'),
};

console.log('PRIVATE KEY, however it arrives');
for (const [label, raw] of Object.entries(manglings)) {
  try {
    check(label, signsCorrectly(raw, pkcs1));
  } catch (error) {
    check(label, false, error.message.split('\n')[0]);
  }
}

console.log('\nUSEFUL FAILURE FOR GENUINELY BAD INPUT');
for (const [label, raw] of Object.entries({
  empty: '',
  whitespace: '   \n  ',
  'not a key at all': 'hello, this is not a private key',
})) {
  try {
    loadPrivateKey(raw);
    check(`${label} is rejected`, false, 'it was accepted');
  } catch (error) {
    // The message must help without ever quoting the value back.
    const helpful = /HHC_GH_APP_PRIVATE_KEY/.test(error.message);
    const leaks = raw.length > 12 && error.message.includes(raw);
    check(`${label} is rejected helpfully`, helpful && !leaks, error.message.split('\n')[0]);
  }
}

// A real key must never appear in an error message, since build logs are kept.
try {
  loadPrivateKey(`${pkcs1.slice(0, 200)}CORRUPTED`);
  check('Corrupted key is rejected', false, 'it was accepted');
} catch (error) {
  const body = pkcs1.split('\n')[1];
  check('Error message never quotes the key', !error.message.includes(body), 'no key material in the message');
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
