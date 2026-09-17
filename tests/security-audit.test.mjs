import { identify } from './helpers/identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { Store } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';
import { Payments } from '../server/payments.mjs';

test('public files cannot expose private artifacts or escape through directory links', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nimduel-security-'));
  const root = join(directory, 'dist');
  const store = new Store(':memory:');
  const server = makeServer({ store, secureCookies: false, staticRoot: root });
  t.after(async () => {
    server.closeAllConnections(); await new Promise(r => server.close(r)); store.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('nimduel-security-'));
    await rm(directory, { recursive: true, force: true });
  });
  for (const path of ['assets', 'licenses', 'flags', 'secrets', '.hidden']) await mkdir(join(root, path), { recursive: true });
  await mkdir(join(directory, 'private'));
  for (const [path, value] of Object.entries({
    'index.html': '<!doctype html><title>Public shell</title>', 'assets/app.js': 'console.log("public")',
    'licenses/library.txt': 'License text', 'flags/NOTICE.txt': 'Flag notice',
    '.env': 'PRIVATE_CANARY_ENV', 'wallet.key': 'PRIVATE_CANARY_KEY', 'backup.tar': 'PRIVATE_CANARY_BACKUP',
    'dump.sqlite': 'PRIVATE_CANARY_DATABASE', 'assets/app.js.map': 'PRIVATE_CANARY_MAP',
    'secrets/notes.html': 'PRIVATE_CANARY_DIRECTORY', '.hidden/info.css': 'PRIVATE_CANARY_HIDDEN',
  })) await writeFile(join(root, path), value);
  await writeFile(join(directory, 'private/info.css'), 'PRIVATE_CANARY_OUTSIDE');
  // Directory junctions also work without symlink privileges on Windows.
  await symlink(join(directory, 'private'), join(root, 'external'), 'junction');
  await symlink(join(root, '.hidden'), join(root, 'internal'), 'junction');
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/play/room', '/assets/app.js', '/licenses/library.txt', '/flags/NOTICE.txt']) {
    const response = await fetch(base + path); assert.equal(response.status, 200, path);
    assert.ok(!(await response.text()).includes('PRIVATE_CANARY'));
  }
  for (const path of ['/.env', '/%2eenv', '/wallet.key', '/backup.tar', '/dump.sqlite', '/assets/app.js.map',
    '/secrets/notes.html', '/external/info.css', '/internal/info.css', '/%2e%2e%5cprivate/info.css', '/.git/config']) {
    const response = await fetch(base + path); assert.equal(response.status, 404, path);
    assert.ok(!(await response.text()).includes('PRIVATE_CANARY'));
  }
  const head = await fetch(base + '/assets/app.js', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('payment endpoints reject outsiders before consulting the financial ledger', async t => {
  const store = new Store(':memory:');
  const server = makeServer({ store, secureCookies: false });
  const owner = identify(store, store.createSession('Owner'), 'owner'), outsider = identify(store, store.createSession('Outsider'), 'outsider');
  const room = store.create(owner.user, { topic: 'math', difficulty: 'normal', language: 'en', mode: 'friends', capacity: 2 });
  let ledgerReads = 0;
  const service = new Payments(store, { view: async () => { ledgerReads++; return {}; }, intent: async () => { ledgerReads++; return {}; } }, { synced: true, address: 'test-treasury' });
  service.reserve = 100000; service.lastSuccess = Date.now(); store.payments = service;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const method of ['GET', 'POST']) {
    for (const cookie of ['', `nimduel_session=${outsider.token}`]) {
      const response = await fetch(`${base}/api/rooms/${room.code}/payment`, { method,
        headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-Nimduel-Client': '1' },
        ...(method === 'POST' ? { body: '{}' } : {}) });
      assert.equal(response.status, cookie ? 403 : 401); await response.text();
    }
  }
  assert.equal(ledgerReads, 0);
});
