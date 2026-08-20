import crypto from 'node:crypto';
import { config } from './config.js';

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

export function hashWebToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function bearerTokenFromRequest(req) {
  const match = String(req.get?.('authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{32,})$/i);
  return match ? match[1] : '';
}

export function resolveWebTokenUser(db, token) {
  if (!token) return null;
  return db.prepare(`SELECT u.id,u.discord_id,u.discord_username,u.steam_id,u.reforger_uid,u.role,u.created_at
    FROM web_auth_tokens t JOIN users u ON u.id=t.user_id
    WHERE t.token_hash=? AND datetime(t.expires_at)>datetime('now')`).get(hashWebToken(token)) || null;
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

export function requireInternal(req, res, next) {
  const supplied = req.get('x-api-key') || req.body?.apiKey || '';
  const expected = config.internalApiKey;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    const fingerprint = supplied
      ? crypto.createHash('sha256').update(supplied).digest('hex').slice(0, 12)
      : 'empty';
    console.warn('[internal-auth] rejected', {
      path: req.originalUrl,
      suppliedLength: a.length,
      fingerprint,
      bodyKeys: Object.keys(req.body || {}),
      contentType: req.get('content-type') || '',
      userAgent: req.get('user-agent') || ''
    });
    return res.status(401).json({ error: 'Invalid internal API key' });
  }
  next();
}

export function attachUser(db) {
  const statement = db.prepare('SELECT id, discord_id, discord_username, steam_id, reforger_uid, role, created_at FROM users WHERE id = ?');
  const touchToken = db.prepare('UPDATE web_auth_tokens SET last_used_at=CURRENT_TIMESTAMP WHERE token_hash=?');
  return (req, _res, next) => {
    req.user = req.session.userId ? statement.get(req.session.userId) : null;
    if (!req.user) {
      const bearer = bearerTokenFromRequest(req);
      req.user = resolveWebTokenUser(db, bearer);
      if (req.user) {
        req.webAuthTokenHash = hashWebToken(bearer);
        touchToken.run(req.webAuthTokenHash);
      }
    }
    if (req.user && req.user.discord_id !== 'demo-dispatch' && req.user.role === 'CIVILIAN') {
      const privilegedUsers = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE discord_id != 'demo-dispatch' AND role IN ('LEO','EMS','DISPATCH','ADMIN')`).get().count;
      const realUsers = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE discord_id != 'demo-dispatch'`).get().count;
      if (privilegedUsers === 0 && realUsers === 1) {
        db.prepare(`UPDATE users SET role='ADMIN' WHERE id=?`).run(req.user.id);
        req.user = statement.get(req.user.id);
      }
    }
    next();
  };
}

export function registerAuthRoutes(app, db) {
  // Discord's mobile authorization view can open the callback more than once.
  // Keep the first exchange promise briefly so every duplicate receives the
  // same successful login instead of trying to redeem a single-use code twice.
  const oauthExchanges = new Map();

  async function exchangeDiscordCode(code, ipAddress) {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.discordClientId,
        client_secret: config.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.discordCallbackUrl
      })
    });
    if (!tokenResponse.ok) {
      const details = await tokenResponse.json().catch(() => ({}));
      const error = new Error(`Discord token exchange failed (${tokenResponse.status})`);
      error.status = tokenResponse.status;
      error.oauthCode = typeof details.error === 'string' ? details.error : 'unknown';
      error.oauthDescription = typeof details.error_description === 'string' ? details.error_description : '';
      throw error;
    }
    const token = await tokenResponse.json();
    const profileResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!profileResponse.ok) throw new Error(`Discord profile request failed (${profileResponse.status})`);
    const profile = await profileResponse.json();
    const displayName = profile.global_name || profile.username;
    db.prepare(`INSERT INTO users (discord_id, discord_username) VALUES (?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET discord_username = excluded.discord_username`).run(profile.id, displayName);
    const user = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(profile.id);
    const privilegedUsers = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE discord_id != 'demo-dispatch' AND role IN ('LEO','EMS','DISPATCH','ADMIN')`).get().count;
    const realUsers = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE discord_id != 'demo-dispatch'`).get().count;
    if (privilegedUsers === 0 && realUsers === 1) db.prepare(`UPDATE users SET role='ADMIN' WHERE id=?`).run(user.id);
    db.prepare(`INSERT INTO audit_logs (user_id,actor_name,action,entity_type,entity_id,details,ip_address) VALUES (?,?,?,?,?,?,?)`)
      .run(user.id, displayName, 'AUTH_LOGIN', 'SESSION', String(user.id), JSON.stringify({ provider: 'Discord' }), ipAddress);
    return user.id;
  }

  function saveSession(req) {
    return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  }

  function frontendLoginRedirect(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO web_auth_tokens (token_hash,user_id,expires_at) VALUES (?,?,?)`)
      .run(hashWebToken(token), userId, expiresAt);
    const base = config.frontendUrl.replace(/#.*$/, '');
    return `${base}#auth_token=${encodeURIComponent(token)}`;
  }

  app.get('/auth/discord', (req, res) => {
    if (!config.discordClientId) return res.status(503).send('Discord OAuth is not configured.');
    if (req.query.retry !== '1') req.session.oauthRetryCount = 0;
    const state = crypto.randomBytes(24).toString('hex');
    req.session.oauthState = state;
    const query = new URLSearchParams({
      client_id: config.discordClientId,
      redirect_uri: config.discordCallbackUrl,
      response_type: 'code',
      scope: 'identify',
      state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${query}`);
  });

  app.get('/auth/discord/callback', async (req, res, next) => {
    try {
      // A mobile browser may revisit an old callback after the first request
      // already created the session. Never redeem the one-time code again.
      if (req.session.userId) return res.redirect(frontendLoginRedirect(req.session.userId));
      const code = req.query.code ? String(req.query.code) : '';
      let exchange = code ? oauthExchanges.get(code) : null;
      if (!exchange) {
        if (!code || req.query.state !== req.session.oauthState) return res.status(400).send('Invalid OAuth state.');
        delete req.session.oauthState;
        exchange = exchangeDiscordCode(code, req.ip);
        oauthExchanges.set(code, exchange);
        setTimeout(() => {
          if (oauthExchanges.get(code) === exchange) oauthExchanges.delete(code);
        }, 120_000).unref?.();
      }
      try {
        req.session.userId = await exchange;
      } catch (error) {
        console.warn('[Discord OAuth] token exchange rejected', {
          status: error.status || 0,
          oauthCode: error.oauthCode || 'unknown',
          description: error.oauthDescription || '',
          retryCount: req.session.oauthRetryCount || 0
        });
        // Discord authorization codes are single-use and mobile embedded
        // browsers sometimes restore a consumed callback. Generate one fresh
        // code automatically, but cap recovery at one attempt to avoid loops.
        if (error.status === 400 && (req.session.oauthRetryCount || 0) < 1) {
          req.session.oauthRetryCount = 1;
          await saveSession(req);
          return res.redirect('/auth/discord?retry=1');
        }
        throw error;
      }
      delete req.session.oauthRetryCount;
      await saveSession(req);
      res.redirect(frontendLoginRedirect(req.session.userId));
    } catch (error) { next(error); }
  });

  if (config.devAuth && config.nodeEnv !== 'production') {
    app.get('/auth/dev', (req, res) => {
      const user = db.prepare('SELECT id FROM users WHERE discord_id = ?').get('demo-dispatch');
      req.session.userId = user.id;
      res.redirect(config.frontendUrl);
    });
  }

  app.post('/auth/logout', (req, res, next) => {
    if (req.user) db.prepare(`INSERT INTO audit_logs (user_id,actor_name,action,entity_type,entity_id,details,ip_address) VALUES (?,?,?,?,?,?,?)`)
      .run(req.user.id, req.user.discord_username, 'AUTH_LOGOUT', 'SESSION', String(req.user.id), '{}', req.ip);
    if (req.webAuthTokenHash) db.prepare('DELETE FROM web_auth_tokens WHERE token_hash=?').run(req.webAuthTokenHash);
    req.session.destroy(error => error ? next(error) : res.status(204).end());
  });
}
