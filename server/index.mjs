import { requireIdentity } from './identity.mjs';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { GameError, requireThat } from './game.mjs';
import { configuredPayments } from './payments.mjs';
import { RateLimit } from './rate-limit.mjs';
import { WALLET_SESSION_TTL_MS } from './wallet-auth.mjs';

function sessionCookie(token, maxAge, secure) {
  // Supply both forms of persistent expiry for embedded browser cookie stores.
  const expires = new Date(maxAge === 0 ? 0 : Date.now() + maxAge * 1000).toUTCString();
  return `nimduel_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}; Expires=${expires}${secure ? '; Secure' : ''}`;
}

function nameOf(value) {
  requireThat(typeof value === 'string', 'INVALID_NAME');
  const name = value.normalize('NFC').trim();
  requireThat(name.length >= 1 && name.length <= 24 && !/[\p{Cc}\p{Cf}]/u.test(name), 'INVALID_NAME');
  return name;
}
async function bodyOf(req) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 'JSON_REQUIRED', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= 8192, 'BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requireThat(body && typeof body === 'object' && !Array.isArray(body), 'INVALID_JSON');
    return body;
  } catch (error) { if (error instanceof GameError) throw error; throw new GameError('INVALID_JSON'); }
}

export function makeServer({ store = new Store(process.env.DATABASE_PATH), publicOrigin = process.env.PUBLIC_ORIGIN,
  secureCookies = process.env.NODE_ENV === 'production', staticRoot = resolve('dist') } = {}) {
  staticRoot = resolve(staticRoot);
  const transportLimit = new RateLimit(10_000);
  const anonymousLimit = new RateLimit(1000);
  const playerLimit = new RateLimit(300);
  const checkRate = (res, wait) => {
    if (wait) { res.setHeader('Retry-After', String(wait)); throw new GameError('TOO_MANY_REQUESTS', 429); }
  };
  const send = (res, code, value) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control', 'no-store');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (!path.startsWith('/api/')) {
        requireThat(req.method === 'GET' || req.method === 'HEAD', 'METHOD_NOT_ALLOWED', 405);
        let relative;
        try { relative = decodeURIComponent(path).replace(/^\/+/, ''); }
        catch { throw new GameError('INVALID_URL', 400); }
        // Only public web assets belong in this route, even if a private file is copied into dist by mistake.
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
        const checkPublicPath = name => {
          const extension = extname(name).toLowerCase();
          requireThat(!/[\\\0:]/.test(name) && !name.split('/').some(part => part.startsWith('.') || /^(?:secrets?|backups?|data|node_modules)$/i.test(part)), 'NOT_FOUND', 404);
          requireThat(!extension || Object.hasOwn(types, extension), 'NOT_FOUND', 404);
          requireThat(extension !== '.txt' || /^(?:licenses\/[^/]+\.txt|flags\/NOTICE\.txt)$/.test(name), 'NOT_FOUND', 404);
          return extension;
        };
        const extension = checkPublicPath(relative);
        let file = resolve(staticRoot, relative || 'index.html');
        requireThat(file.startsWith(staticRoot + sep), 'NOT_FOUND', 404);
        const realRoot = await realpath(staticRoot);
        const publicFile = async target => {
          const actual = await realpath(target);
          // A symlink inside dist must not expose files outside the public directory.
          requireThat(actual.startsWith(realRoot + sep), 'NOT_FOUND', 404);
          requireThat(checkPublicPath(actual.slice(realRoot.length + 1).split(sep).join('/')), 'NOT_FOUND', 404);
          return readFile(actual);
        };
        let content;
        try { content = await publicFile(file); }
        catch (error) { if (error instanceof GameError) throw error; requireThat(!extension, 'NOT_FOUND', 404); file = resolve(staticRoot, 'index.html'); content = await publicFile(file); }
        res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      const ip = req.socket.remoteAddress ?? 'unknown';
      checkRate(res, transportLimit.take(ip));
      const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('nimduel_session='))?.slice(16);
      const rateUser = store.session(token);
      checkRate(res, rateUser ? playerLimit.take(rateUser.id) : anonymousLimit.take(ip));
      if (publicOrigin && req.headers.origin === publicOrigin) {
        res.setHeader('Access-Control-Allow-Origin', publicOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'GET' && path === '/api/health') return send(res, 200, { status: 'ok', paymentsEnabled: store.payments?.status().ready ?? false });
      if (req.method === 'GET' && path === '/api/payments') return send(res, 200, store.payments?.status() ?? { ready: false, network: 'testalbatross', reason: 'disabled' });
      if (req.method !== 'GET') {
        requireThat(req.method === 'POST', 'METHOD_NOT_ALLOWED', 405);
        // Custom header and JSON force preflight; only our same-origin client is accepted.
        requireThat(req.headers['x-nimduel-client'] === '1', 'INVALID_CLIENT', 403);
        const expected = publicOrigin ?? `http://${req.headers.host}`;
        if (req.headers.origin) requireThat(req.headers.origin === expected, 'ORIGIN_DENIED', 403);
        requireThat(req.headers['sec-fetch-site'] !== 'cross-site', 'ORIGIN_DENIED', 403);
      }
      // Revalidate authorization after reading input: logout or rotation may happen while a body streams in.
      const input = req.method === 'POST' ? await bodyOf(req) : undefined;
      let user = store.session(token);
      if (path === '/api/session' && req.method === 'POST') {
        const name = nameOf(input.name);
        if (user) user = store.rename(user, name);
        else {
          const session = store.createSession(name); user = session.user;
          res.setHeader('Set-Cookie', sessionCookie(session.token, 2592000, secureCookies));
        }
        return send(res, 200, { user });
      }
      if (path === '/api/session' && req.method === 'GET') return send(res, 200, { user });
      if (path === '/api/leaderboard' && req.method === 'GET') return send(res, 200, store.leaderboard(user, url.searchParams.get('category') ?? 'math'));
      requireThat(user, 'SESSION_REQUIRED', 401);
      if (path === '/api/presence' && req.method === 'POST') return send(res, 200, store.heartbeatPresence(user, token));
      if (path === '/api/nickname' && req.method === 'POST') return send(res, 200, { user: store.claimNickname(user, input.nickname) });
      if (path === '/api/players' && req.method === 'GET') return send(res, 200, store.lookupPlayer(user, url.searchParams.get('nickname')));
      if (path === '/api/friends' && req.method === 'GET') return send(res, 200, store.friends(user));
      if (path === '/api/friends' && req.method === 'POST') return send(res, 200, store.changeFriend(user, input.nickname, input.action));
      if (path === '/api/invitations' && req.method === 'GET') return send(res, 200, store.invitations(user));
      const invitationMatch = /^\/api\/invitations\/([a-f0-9-]{36})\/(accept|decline|cancel)$/.exec(path);
      if (invitationMatch && req.method === 'POST') return send(res, 200, store.invitation(user, invitationMatch[1], invitationMatch[2]));
      if (path === '/api/logout' && req.method === 'POST') {
        store.logout(user, token);
        res.setHeader('Set-Cookie', sessionCookie('', 0, secureCookies));
        return send(res, 200, { user: null });
      }
      if (path === '/api/wallet/challenge' && req.method === 'POST') {
        return send(res, 200, store.walletChallenge(user, token, publicOrigin ?? `http://${req.headers.host}`, input));
      }
      if (path === '/api/wallet/verify' && req.method === 'POST') {
        const verified = store.verifyWallet(user, token, publicOrigin ?? `http://${req.headers.host}`, input);
        res.setHeader('Set-Cookie', sessionCookie(verified.token, WALLET_SESSION_TTL_MS / 1000, secureCookies));
        return send(res, 200, { user: verified.user });
      }
      // Gameplay requires an authenticated wallet and its unique registered nickname.
      requireThat(user.wallet, 'VERIFIED_WALLET_REQUIRED', 403);
      requireIdentity(store, user);
      if (path === '/api/rooms' && req.method === 'GET') return send(res, 200, { rooms: store.history(user.id) });
      if (path === '/api/rematches' && req.method === 'GET') return send(res, 200, store.rematches(user));
      const decline = /^\/api\/rematches\/([A-F0-9]{10})\/decline$/.exec(path);
      if (decline && req.method === 'POST') return send(res, 200, store.declineRematch(decline[1], user));
      if (path === '/api/progress' && req.method === 'GET') return send(res, 200, store.progress(user.id));
      if (path === '/api/search' && req.method === 'GET') return send(res, 200, store.search(user, 'view'));
      const searchMatch = /^\/api\/search\/(start|heartbeat|cancel)$/.exec(path);
      if (searchMatch && req.method === 'POST') return send(res, 200, store.search(user, searchMatch[1], input));
      const rematch = /^\/api\/rooms\/([A-F0-9]{10})\/rematch$/.exec(path);
      if (rematch && req.method === 'POST') return send(res, 200, store.rematch(rematch[1], user));
      if (path === '/api/rooms' && req.method === 'POST') return send(res, 201, store.create(user, input));
      const paymentMatch = /^\/api\/rooms\/([A-F0-9]{10})\/payment$/.exec(path);
      if (paymentMatch) {
        requireThat(store.payments, 'PAYMENTS_UNAVAILABLE', 503);
        return send(res, 200, req.method === 'POST' ? await store.payments.intent(paymentMatch[1], user, input) : await store.payments.view(paymentMatch[1], user));
      }
      const match = /^\/api\/rooms\/([A-F0-9]{10})(?:\/(join|leave|ready|start|answer|finish|heartbeat|move|hint|undo|resign|offerDraw|acceptDraw|declineDraw))?$/.exec(path);
      requireThat(match, 'NOT_FOUND', 404);
      if (req.method === 'GET' && !match[2]) return send(res, 200, store.view(match[1], user.id));
      if (req.method === 'POST' && match[2]) return send(res, 200, store.action(match[1], user, match[2], input));
      throw new GameError('NOT_FOUND', 404);
    } catch (error) {
      const known = error instanceof GameError;
      if (!known) console.error('Request failed:', error.code ?? error.name);
      if (!res.headersSent) send(res, known ? error.status : 500, { error: known ? error.code : 'SERVER_ERROR' });
      else res.end();
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN?.startsWith('https://')) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin in production');
  const store = new Store(process.env.DATABASE_PATH);
  store.tick(true);
  const payments = await configuredPayments(store);
  let lastTick = Date.now();
  const interval = setInterval(() => {
    const now = Date.now();
    try { store.tick(now - lastTick > 5000 || now < lastTick); lastTick = now; }
    catch (error) { console.error('Game clock failed:', error.code ?? error.name); process.exit(1); }
  }, 1000);
  const server = makeServer({ store });
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`NimDuel API: http://127.0.0.1:${port}`));
  const stop = () => { clearInterval(interval); server.close(async () => { await payments?.close(); store.close(); process.exit(0); }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
