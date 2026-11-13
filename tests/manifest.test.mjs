import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('plugins/free-kilo/manifest.json', root), 'utf8'));

test('site identity and allowed upstream are fixed', () => {
  assert.equal(manifest.id, 'zkl2333.free-kilo');
  assert.equal(manifest.siteProvider.siteType, 'zkl2333.free-kilo/gateway');
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

test('generic key check places placeholder in a separate header', () => {
  // listModels 钩子接管了模型列表；models.path/auth 仍供通用适配器验 Key 与健康检查。
  assert.equal(manifest.siteProvider.models.path, '/models');
  assert.equal(manifest.siteProvider.models.auth, 'header:X-Kilo-Free-Key');
});

test('model list hook keeps only isFree models', () => {
  const source = readFileSync(new URL('plugins/free-kilo/src/index.ts', root), 'utf8');
  assert.match(source, /export function listModels\(/);
  const fixture = JSON.parse(readFileSync(new URL('plugins/free-kilo/fixtures/list-models.json', root), 'utf8'));
  const upstream = fixture.responses[0].json.data;
  const free = upstream.filter(item => item.isFree === true).map(item => item.id);
  assert.ok(upstream.length > free.length, 'fixture must include paid models to filter out');
  assert.deepEqual(fixture.expect.result.models.map(model => model.name), free);
  for (const model of fixture.expect.result.models) {
    assert.deepEqual(model.capabilities.supported_endpoint_types, ['openai']);
  }
});

test('private credentials and signing keys are ignored', () => {
  const ignore = readFileSync(new URL('.gitignore', root), 'utf8');
  for (const rule of ['.env', '.env.*', '*.pem', '*.xlp', '*.exe']) {
    assert.ok(ignore.split(/\r?\n/).includes(rule), `missing ${rule}`);
  }
});
