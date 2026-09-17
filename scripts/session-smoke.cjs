// Tests with an isolated persistent Chrome profile, no saved browser state injection.
// Uses an already installed browser and Playwright; never downloads either.
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve, join, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const locales = require('../shared/locales.json');

(async () => {
  const root = resolve(__dirname, '..');
  const { Store } = await import(pathToFileURL(join(root, 'server/store.mjs')));
  const { makeServer } = await import(pathToFileURL(join(root, 'server/index.mjs')));
  const { messageDigest } = await import(pathToFileURL(join(root, 'server/wallet-auth.mjs')));
  const { KeyPair } = await import('@nimiq/core');
  const dir = await mkdtemp(join(tmpdir(), 'nimduel-session-'));
  let store, server, context, port = 0;
  const errors = [];
  async function startServer() {
    store = new Store(join(dir, 'test.sqlite'));
    server = makeServer({ store, secureCookies: false, staticRoot: join(root, 'dist') });
    await new Promise(r => server.listen(port, '127.0.0.1', r));
    port = server.address().port;
  }
  async function stopServer() {
    server.closeAllConnections();
    await new Promise(r => server.close(r)); store.close(); server = store = null;
  }
  async function openBrowser() {
    context = await chromium.launchPersistentContext(join(dir, 'profile'), {
      headless: true, locale: 'en', viewport: { width: 375, height: 750 },
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    });
    const page = context.pages()[0];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`);
    return page;
  }
  async function post(page, path, body) {
    const result = await page.evaluate(async ({ path, body }) => {
      const response = await fetch('/api' + path, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Nimduel-Client': '1' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }, { path, body });
    assert.equal(result.status, 200, path); return result.body;
  }
  try {
    await startServer();
    let page = await openBrowser();
    await page.getByText(locales.en.welcomeTitle, { exact: true }).waitFor();
    const key = KeyPair.generate();
    const address = key.toAddress(), publicKey = key.publicKey;
    try {
      await post(page, '/session', { name: 'Persistent QA' });
      const challenge = await post(page, '/wallet/challenge', { address: address.toUserFriendlyAddress(), language: 'en' });
      const signature = key.sign(messageDigest(challenge.message));
      try { await post(page, '/wallet/verify', { challengeId: challenge.id, publicKey: publicKey.toHex(), signature: signature.toHex() }); }
      finally { signature.free(); }
      await post(page, '/nickname', { nickname: 'persistent_qa' });
    } finally { publicKey.free(); address.free(); key.free(); }
    await page.reload(); await page.locator('.game-catalog').waitFor();
    const cookie = (await context.cookies()).find(c => c.name === 'nimduel_session');
    assert.ok(cookie.httpOnly && cookie.sameSite === 'Strict');
    assert.ok(cookie.expires > Date.now() / 1000 + 86000);
    assert.equal(await page.evaluate(() => document.cookie.includes('nimduel_session')), false);

    // Fully terminate both browser and server, then use the same profile and database.
    await context.close(); context = null; await stopServer(); await startServer();
    page = await openBrowser(); await page.locator('.game-catalog').waitFor();
    assert.equal(await page.getByText(locales.en.welcomeTitle, { exact: true }).count(), 0);

    await page.route('**/api/session', route => route.abort('failed'));
    await page.reload(); await page.getByRole('button', { name: locales.en.retry, exact: true }).waitFor();
    assert.equal(await page.getByText(locales.en.welcomeTitle, { exact: true }).count(), 0);
    await page.unroute('**/api/session');
    await page.getByRole('button', { name: locales.en.retry, exact: true }).click();
    await page.locator('.game-catalog').waitFor();

    await page.route('**/api/session', route => route.abort('failed'));
    const failed = page.waitForEvent('requestfailed', request => request.url().endsWith('/api/session'));
    await page.evaluate(() => window.dispatchEvent(new Event('nimduel-auth-required'))); await failed;
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('.game-catalog').count(), 1);
    await page.unroute('**/api/session');

    await page.locator('.navigation').getByRole('button', { name: locales.en.wallet, exact: true }).click();
    await page.getByRole('button', { name: locales.en.logout, exact: true }).click();
    await page.getByText(locales.en.welcomeTitle, { exact: true }).waitFor();
    assert.equal((await context.cookies()).some(c => c.name === 'nimduel_session'), false);
    await context.close(); context = null;
    page = await openBrowser(); await page.getByText(locales.en.welcomeTitle, { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: full browser/server restart preserves login; network failures do not force wallet connection; logout persists.');
  } finally {
    if (context) await context.close();
    if (server) await stopServer();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep) && dir.includes('nimduel-session-'));
    await rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
