// Uses an already installed Playwright and Chrome; never downloads a browser.
// PLAYWRIGHT_MODULE and CHROME_PATH may point to an existing installation.
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const locales = require('../shared/locales.json');

(async () => {
  const root = resolve(__dirname, '..');
  const { Store } = await import(pathToFileURL(resolve(root, 'server/store.mjs')));
  const { makeServer } = await import(pathToFileURL(resolve(root, 'server/index.mjs')));
  const { messageDigest } = await import(pathToFileURL(resolve(root, 'server/wallet-auth.mjs')));
  const { KeyPair, Address } = await import('@nimiq/core');
  const { identify } = await import(pathToFileURL(resolve(root, 'tests/helpers/identity.mjs')));
  const store = new Store(':memory:');
  const timer = setInterval(() => store.tick(), 100);
  const server = makeServer({ store, secureCookies: false, staticRoot: resolve(root, 'dist') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const errors = [], contexts = [];
  const context = async (lang = 'en', width = 375, authenticated = true) => {
    const c = await browser.newContext({ viewport: { width, height: 850 }, locale: lang }); contexts.push(c);
    await c.addInitScript(l => { localStorage.setItem('nimduel-language', l); localStorage.setItem('nimduel-name', 'Release QA'); }, lang);
    if (authenticated) {
      const session = identify(store, store.createSession('QA'), 'qa_' + contexts.length, base);
      await c.addCookies([{ name: 'nimduel_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' }]);
    }
    const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(base); return p;
  };
  const button = (p, name) => p.getByRole('button', { name, exact: true });
  const view = async p => (await p.request.get(base + '/api/rooms/' + new URL(p.url()).searchParams.get('room'))).json();
  const mutation = async (p, suffix, click) => {
    const [response] = await Promise.all([p.waitForResponse(r => r.url().endsWith(suffix) && r.request().method() === 'POST'), click()]);
    assert.ok(response.ok(), `${suffix}: ${response.status()}`); return response.json();
  };
  const noOverflow = async p => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${p.viewportSize().width}px`);
  try {
    for (const [index, lang] of Object.keys(locales).entries()) {
      const t = locales[lang], p = await context(lang, index % 2 ? 320 : 375);
      await p.locator('.game-catalog').waitFor();
      await p.setViewportSize({ width: p.viewportSize().width, height: 568 });
      assert.equal(await p.locator('.game-catalog .topic-card').count(), 6);
      assert.equal(await p.locator('.game-catalog .topic-description:visible').count(), 6);
      await p.locator('.topic-card.chess').click(); await p.locator('.game-launch').waitFor();
      assert.equal(await p.locator('.game-launch h1').textContent(), t.chess);
      assert.equal(await p.locator('.game-launch h1').evaluate(h => h === document.activeElement), true);
      await p.locator('.practice-controls .select-trigger').click();
      assert.equal(await p.getByRole('option').count(), 6); await p.keyboard.press('Escape');
      const launch = await p.locator('.launch-play').boundingBox(), nav = await p.locator('.navigation').boundingBox();
      assert.ok(launch.y + launch.height <= nav.y, lang + ': hidden launch button');
      await p.locator('.launch-back').click();
      await p.setViewportSize({ width: p.viewportSize().width, height: 850 });
      await button(p, t.about).click(); await p.getByRole('dialog').waitFor(); await noOverflow(p);
      await p.keyboard.press('Escape'); await button(p, t.language).click();
      assert.equal(await p.locator('.language-option').count(), 6); await p.keyboard.press('Escape');
      for (const topic of ['math', 'flags', 'capitals', 'mixed']) {
        await p.locator('.topic-card.' + topic).click();
        await p.locator('.practice-controls .select-trigger').click();
        await p.getByRole('option', { name: t[['easy', 'normal', 'hard'][index % 3]], exact: true }).click();
        await button(p, t.playSolo).click(); await p.locator('.game-panel').waitFor(); await noOverflow(p);
        let room = await view(p);
        const answer = store.load(room.code).players[0].questions[0].answer;
        if (room.question.kind === 'math') {
          await p.locator('.answer-display').focus(); await p.keyboard.type(String(answer));
          room = await mutation(p, '/answer', () => p.keyboard.press('Enter'));
        } else {
          const i = room.question.options.findIndex(o => o.id === answer);
          room = await mutation(p, '/answer', () => p.locator('.flag-options button').nth(i).click());
        }
        assert.equal(room.me.score, 1);
        room = await mutation(p, '/answer', () => button(p, t.skip).click());
        assert.equal(room.me.answered, 2);
        await p.reload(); await p.locator('.game-panel').waitFor(); assert.equal((await view(p)).me.answered, 2);
        if (room.question.kind === 'math') {
          await p.locator('.answer-display').focus(); await p.keyboard.type('123');
          // Enter on Finish must activate Finish, never submit the arithmetic answer.
          await button(p, t.finish).focus();
          room = await mutation(p, '/finish', () => p.keyboard.press('Enter'));
        } else room = await mutation(p, '/finish', () => button(p, t.finish).click());
        assert.equal(room.me.answered, 2); assert.equal(room.status, 'completed');
        await p.locator('.result-panel').waitFor(); assert.equal(await p.locator('.review-item').count(), 2);
        await noOverflow(p); await button(p, t.again).click();
      }
      await p.locator('.topic-card.puzzles').click(); await button(p, t.puzzlePlay).click();
      await p.locator('.puzzle-layout').waitFor(); await noOverflow(p);
      const hinted = await mutation(p, '/hint', () => button(p, t.puzzleHint).click());
      assert.ok(hinted.puzzle.hint); await p.locator('.puzzle-hint-square').first().waitFor();
      await mutation(p, '/finish', () => button(p, t.puzzleReveal).click()); await button(p, t.puzzleNext).waitFor();
      await button(p, t.puzzleNext).click(); await button(p, t.puzzleReveal).waitFor();
      await mutation(p, '/finish', () => button(p, t.puzzleReveal).click());
      await p.locator('.navigation').getByRole('button', { name: t.wallet, exact: true }).click();
      await button(p, t.logout).click();
      await p.getByText(t.welcomeTitle, { exact: true }).waitFor();
      assert.equal(await p.locator('.navigation').count(), 0);
      await p.getByText(t.walletOutside, { exact: true }).waitFor();
      await button(p, t.connect).click(); await p.getByRole('alert').waitFor();
      await noOverflow(p); await p.context().close();
    }
    // Real signature verification with an in-memory test wallet and a mocked native bridge.
    const key = KeyPair.generate(), addressObject = key.toAddress(), publicKey = key.publicKey;
    const address = addressObject.toUserFriendlyAddress(); addressObject.free();
    try {
      const p = await context('en', 768, false), t = locales.en;
      await p.exposeFunction('testSign', message => {
        const signature = key.sign(messageDigest(message));
        try { return { publicKey: publicKey.toHex(), signature: signature.toHex() }; } finally { signature.free(); }
      });
      await p.addInitScript(address => {
        window.nativeApprovals = 0; window.rejectSign = true; window.paymentApprovals = 0; window.paymentOutcome = 'reject';
        window.nimiq = { isConsensusEstablished: async () => true,
          listAccounts: async () => { window.nativeApprovals++; return [address]; },
          sign: async ({ message }) => { window.nativeApprovals++; return window.rejectSign ? { error: { type: 'cancelled', message: 'Cancelled' } } : window.testSign(message); },
          sendBasicTransactionWithData: async tx => {
            window.paymentApprovals++; window.lastPayment = tx;
            if (window.paymentOutcome === 'hold') return new Promise(resolve => { window.resolvePayment = resolve; });
            if (window.paymentOutcome === 'throw') throw new Error('Unknown broadcast result');
            return window.paymentOutcome === 'hash' ? 'b'.repeat(64) : { error: { type: 'cancelled', message: 'Cancelled' } };
          } };
      }, address);
      await p.reload(); assert.equal(await p.evaluate(() => window.nativeApprovals), 0);
      assert.equal(await p.locator('.navigation').count(), 0);
      await button(p, t.connect).click(); await button(p, t.verifyWallet).click();
      await p.getByText(t.signatureCancelled, { exact: true }).waitFor();
      await p.evaluate(() => { window.rejectSign = false; }); await button(p, t.verifyWallet).click();
      await button(p, t.logout).waitFor(); assert.ok((await (await p.request.get(base + '/api/session')).json()).user.wallet);
      assert.equal(await p.locator('.navigation').count(), 0, 'a signature alone must not unlock gameplay');
      await p.locator('.nickname-section input').fill('native_tester');
      await button(p, t.claimNickname).click();
      await p.locator('.navigation').waitFor();
      assert.equal(await p.locator('.navigation svg.nav-icon').count(), 4);
      await p.reload(); await p.locator('.navigation').waitFor();
      assert.equal(await p.evaluate(() => window.nativeApprovals), 0, 'returning players need no new wallet prompts');
      await noOverflow(p);
      // Payment UI only: no chain transaction is sent by this mocked bridge/service.
      const owner = (await (await p.request.get(base + '/api/session')).json()).user;
      const otherKey = KeyPair.generate(), otherAddress = otherKey.toAddress();
      const otherSession = store.createSession('Payment UI peer');
      const challenge = store.walletChallenge(otherSession.user, otherSession.token, base, { address: otherAddress.toUserFriendlyAddress(), language: 'en' });
      const otherSignature = otherKey.sign(messageDigest(challenge.message)), otherPublicKey = otherKey.publicKey;
      const other = store.verifyWallet(otherSession.user, otherSession.token, base, { challengeId: challenge.id, publicKey: otherPublicKey.toHex(), signature: otherSignature.toHex() }).user;
      otherSignature.free(); otherPublicKey.free(); otherAddress.free(); otherKey.free();
      const treasuryAddress = new Address(new Uint8Array(20).fill(9));
      const treasury = treasuryAddress.toUserFriendlyAddress(); treasuryAddress.free();
      let intent = null;
      store.payments = {
        status: () => ({ ready: true, address: treasury, network: 'testalbatross' }),
        intent: async () => intent ??= { id: 'a'.repeat(64), sender: address, recipient: treasury, amountLuna: 100000, memo: 'UI TEST ONLY', expiresAt: Date.now() + 60000 },
        view: async () => ({ intent, payouts: [] }),
      };
      const paidRoom = store.create(owner, { topic: 'math', difficulty: 'normal', language: 'en', mode: 'friends', capacity: 2, stake: 100000 });
      store.action(paidRoom.code, other, 'join', {});
      await p.goto(base + '/?room=' + paidRoom.code); await button(p, t.prepareEntry).click();
      assert.equal(await p.evaluate(() => window.paymentApprovals), 0);
      assert.ok(await button(p, t.payTest).isDisabled());
      await p.getByRole('checkbox', { name: t.acceptTestnet, exact: true }).check();
      await p.evaluate(() => { window.paymentOutcome = 'hold'; });
      await button(p, t.payTest).click(); await p.getByText(t.paymentWalletWaiting, { exact: true }).waitFor();
      assert.equal(await p.getByText(t.paymentWaiting, { exact: true }).count(), 0);
      assert.equal(await button(p, t.paymentRetry).count(), 0, 'no second request while the wallet call is pending');
      await p.evaluate(() => window.resolvePayment({ error: { type: 'cancelled' } }));
      await p.getByText(t.paymentNotConfirmed, { exact: true }).waitFor();
      assert.equal(await p.getByText(t.paymentWaiting, { exact: true }).count(), 0);
      assert.equal(await p.evaluate(() => window.paymentApprovals), 1);
      assert.equal(await p.evaluate(() => window.lastPayment.value), 100000);
      await button(p, t.paymentRetry).click();
      await p.getByRole('checkbox', { name: t.acceptTestnet, exact: true }).check();
      await p.evaluate(() => { window.paymentOutcome = 'throw'; }); await button(p, t.payTest).click();
      await p.getByText(t.paymentCheckHistory, { exact: true }).waitFor();
      await button(p, t.paymentRetry).click();
      await p.getByRole('checkbox', { name: t.acceptTestnet, exact: true }).check();
      await p.evaluate(() => { window.paymentOutcome = 'hash'; }); await button(p, t.payTest).click();
      await p.getByText(t.paymentWaiting, { exact: true }).waitFor();
      assert.equal((await view(p)).players[0].funded, false, 'a returned hash never credits a deposit');
      assert.equal(await p.evaluate(() => window.paymentApprovals), 3);
      await button(p, t.paymentRetry).click();
      await p.getByRole('checkbox', { name: t.acceptTestnet, exact: true }).check();
      await p.evaluate(() => { delete window.nimiq; }); await button(p, t.payTest).click();
      await p.getByText(t.walletOutside, { exact: true }).waitFor();
      assert.equal(await p.evaluate(() => window.paymentApprovals), 3);
      // Reopening a WebView can lose both cookies and the room URL. A fresh proof
      // must recover the existing funded seat, rather than block or charge again.
      store.markFunded(paidRoom.code, [{ playerId: owner.id, address, amountLuna: 100000, hash: 'c'.repeat(64) }]);
      const beforeRecovery = store.load(paidRoom.code);
      await p.context().clearCookies(); await p.goto(base);
      await button(p, t.connect).waitFor();
      await p.evaluate(() => { window.rejectSign = false; });
      await button(p, t.connect).click(); await button(p, t.verifyWallet).click();
      await p.getByText(t.entryConfirmed, { exact: false }).waitFor();
      assert.equal(new URL(p.url()).searchParams.get('room'), paidRoom.code);
      assert.equal((await view(p)).me.id, owner.id);
      assert.deepEqual(store.load(paidRoom.code), beforeRecovery);
      assert.equal(await p.evaluate(() => window.paymentApprovals), 0, 'recovering a funded room must not ask for another payment');
      await p.goto(base); await p.getByText(t.entryConfirmed, { exact: false }).waitFor();
      assert.equal(new URL(p.url()).searchParams.get('room'), paidRoom.code);
      store.action(paidRoom.code, owner, 'leave', {}); store.payments = undefined;
      await p.locator('.navigation').getByRole('button', { name: t.wallet, exact: true }).click();
      await button(p, t.logout).click(); await button(p, t.connect).waitFor();
      await p.context().close();
    } finally { publicKey.free(); key.free(); }
    // Two real browser sessions discover each other through public matchmaking.
    const a = await context(), b = await context(), t = locales.en;
    await a.locator('.topic-card.math').click(); await b.locator('.topic-card.math').click();
    await button(a, t.quickMatch).click(); await button(b, t.quickMatch).click();
    await a.locator('.room-heading').waitFor(); await b.locator('.room-heading').waitFor();
    assert.equal((await view(a)).code, (await view(b)).code);
    await button(a, t.ready).click(); await button(b, t.ready).click();
    await button(a, t.start).click(); await button(b, t.start).click();
    await a.context().setOffline(true); await a.locator('.connection-warning').waitFor();
    await a.context().setOffline(false); await a.locator('.connection-warning').waitFor({ state: 'hidden' });
    await button(a, t.finish).click(); await button(b, t.finish).click();
    await a.locator('.result-panel').waitFor(); await b.locator('.result-panel').waitFor();
    // The game-specific friends flow still creates a room that can be joined by code.
    await button(a, t.again).click(); await button(b, t.again).click();
    await a.locator('.topic-card.flags').click(); await button(a, t.friends).click();
    await button(a, t.create).click(); await a.locator('.room-heading').waitFor();
    const friendRoom = await view(a); assert.equal(friendRoom.topic, 'flags');
    await b.locator('.home-join summary').click(); await b.locator('.home-join input').fill(friendRoom.code);
    await button(b, t.join).click(); await b.locator('.room-heading').waitFor();
    assert.equal((await view(b)).players.length, 2);
    await button(b, t.leave).click(); await button(a, t.leave).click();
    // Paid human chess through the UI. Wallet and chain are isolated test doubles.
    const mainText = { ...t, ...require('../shared/mainnet-locales.json').en };
    const treasuryAddress = new Address(new Uint8Array(20).fill(8));
    const treasury = treasuryAddress.toUserFriendlyAddress(); treasuryAddress.free();
    const intents = new Map();
    store.payments = {
      status: () => ({ ready: true, address: treasury, network: 'mainalbatross', feeContributionLuna: 1000 }),
      intent: async (code, user) => {
        const room = store.load(code);
        const key = room.code + user.id;
        if (!intents.has(key)) intents.set(key, { network: 'mainalbatross', id: key, sender: user.wallet.address, recipient: treasury,
          feeContributionLuna: 1000, amountLuna: room.stakeLuna + 1000, memo: 'BROWSER TEST ONLY', expiresAt: Date.now() + 600000 });
        return intents.get(key);
      },
      view: async (code, user) => ({ intent: intents.get(code + user.id) ?? null, payouts: [] }),
    };
    for (const p of [a, b]) {
      await p.context().addInitScript(() => {
        window.paymentApprovals = 0;
        window.nimiq = { sendBasicTransactionWithData: async tx => { window.paymentApprovals++; window.lastPayment = tx; return 'd'.repeat(64); } };
      });
      await p.goto(base); await p.locator('.topic-card.chess').click();
      await p.locator('.entry-choice .select-trigger').click();
      await p.getByRole('option', { name: '1 NIM', exact: true }).click();
      await noOverflow(p);
    }
    await a.screenshot({ path: resolve(require('node:os').tmpdir(), 'nimduel-paid-chess.png'), fullPage: true });
    await button(a, t.quickMatch).click();
    await a.locator('.search-entry').getByText(/1 NIM/).waitFor();
    await button(b, t.quickMatch).click();
    await a.locator('.room-heading').waitFor(); await b.locator('.room-heading').waitFor();
    const chessRoom = await view(a); assert.equal(chessRoom.code, (await view(b)).code);
    assert.equal(chessRoom.stakeLuna, 100000);
    for (const p of [a, b]) {
      assert.ok(await button(p, t.ready).isDisabled());
      assert.equal(await p.evaluate(() => window.paymentApprovals), 0);
      await button(p, t.prepareEntry).click();
      assert.ok(await button(p, mainText.payTest).isDisabled());
      await p.getByRole('checkbox', { name: mainText.acceptTestnet, exact: true }).check();
      await button(p, mainText.payTest).click(); await p.getByText(t.paymentWaiting, { exact: true }).waitFor();
      assert.equal(await p.evaluate(() => window.lastPayment.value), 100000);
      assert.ok((await view(p)).players.every(player => !player.funded));
    }
    store.markFunded(chessRoom.code, store.load(chessRoom.code).players.map((p, i) => ({
      playerId: p.id, address: p.walletAddress, amountLuna: 100000, hash: String(i + 5).repeat(64),
    })));
    for (const p of [a, b]) { await p.getByText(t.entryConfirmed, { exact: false }).waitFor(); await button(p, t.ready).click(); }
    for (const p of [a, b]) await button(p, t.start).click();
    await button(a, t.chessResign).click(); await a.locator('.chess-resign-confirm').getByRole('button', { name: t.chessResign, exact: true }).click();
    await a.locator('.chess-replay').waitFor(); await b.locator('.chess-replay').waitFor();
    assert.equal((await view(a)).status, 'completed');
    // The recipient sees the chosen stake before accepting a nickname invitation.
    const peer = (await (await b.request.get(base + '/api/session')).json()).user;
    await a.locator('.navigation').getByRole('button', { name: t.profile, exact: true }).click();
    await button(a, t.people).click(); await a.locator('.people-search input').fill(peer.nickname);
    await button(a, t.findPlayer).click(); await button(a, t.inviteDuel).click();
    await a.locator('.setup-panel .entry-choice .select-trigger').click();
    await a.getByRole('option', { name: '5 NIM', exact: true }).click();
    await button(a, t.sendInvitation).click(); await a.locator('.room-heading').waitFor();
    await b.locator('.invitation-banner').click();
    const incoming = b.locator('.invitation-item').filter({ has: button(b, t.acceptInvitation) });
    await incoming.getByText(/5 NIM/).waitFor(); await noOverflow(b);
    await button(b, t.acceptInvitation).click(); await b.locator('.room-heading').waitFor();
    assert.equal((await view(b)).stakeLuna, 500000);
    assert.ok(await button(b, t.ready).isDisabled());
    assert.deepEqual(errors, []);
    console.log('PASS: six illustrated game cards with descriptions, game-specific launch and friends/code join; 6 languages; 320/375/768px; 24 quiz rounds across all 3 levels; keyboard, scoring, skip, reload, review; puzzles; about/language dialogs; wallet absence/cancel/signature/logout; payment consent/cancel/unknown outcome/non-authoritative hash (mock bridge); two-player matchmaking and offline recovery; Mainnet human chess matchmaking and nickname invitation with explicit real-NIM consent (mock bridge, no real transfers).');
  } finally {
    clearInterval(timer); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); store.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
