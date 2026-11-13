import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('plugins/free-kilo/manifest.json', root), 'utf8'));

test('site identity and allowed upstream are fixed', () => {
  assert.equal(manifest.id, 'free-kilo');
  assert.equal(manifest.siteProvider.siteType, 'free-kilo/gateway');
  assert.deepEqual(manifest.siteProvider.hosts, ['api.kilo.ai']);
  assert.equal(manifest.siteProvider.protocol.officialBaseURL, 'https://api.kilo.ai/api/gateway');
});

test('chat forwarding strips adapter authentication', () => {
  const request = manifest.siteProvider.request;
  assert.equal(request.stripDownstreamHeaders, true);
  assert.ok(Object.keys(request.headers).length > 0);
  assert.ok(!Object.keys(request.headers).some(key => /^(authorization|x-api-key|cookie)$/i.test(key)));
  assert.equal(manifest.siteProvider.protocol.path, '/chat/completions');
});

test('model listing places placeholder in a separate header', () => {
  assert.equal(manifest.siteProvider.models.path, '/models');
  assert.equal(manifest.siteProvider.models.auth, 'header:X-Kilo-Free-Key');
});

test('private credentials and signing keys are ignored', () => {
  const ignore = readFileSync(new URL('.gitignore', root), 'utf8');
  for (const rule of ['.env', '.env.*', '*.pem', '*.xlp', '*.exe']) {
    assert.ok(ignore.split(/\r?\n/).includes(rule), `missing ${rule}`);
  }
});
