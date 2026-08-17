import crypto from 'node:crypto';
import { config } from './config.js';

export function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Authentication required' });
  next();
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
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Invalid internal API key' });
  next();
}

export function attachUser(db) {
  const statement = db.prepare('SELECT id, discord_id, discord_username, steam_id, reforger_uid, role, created_at FROM users WHERE id = ?');
  return (req, _res, next) => {
    req.user = req.session.userId ? statement.get(req.session.userId) : null;
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
  app.get('/auth/discord', (req, res) => {
    if (!config.discordClientId) return res.status(503).send('Discord OAuth is not configured.');
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
      if (!req.query.code || req.query.state !== req.session.oauthState) return res.status(400).send('Invalid OAuth state.');
      delete req.session.oauthState;
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.discordClientId,
          client_secret: config.discordClientSecret,
          grant_type: 'authorization_code',
          code: String(req.query.code),
          redirect_uri: config.discordCallbackUrl
        })
      });
      if (!tokenResponse.ok) throw new Error(`Discord token exchange failed (${tokenResponse.status})`);
      const token = await tokenResponse.json();
      const profileResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!profileResponse.ok) throw new Error(`Discord profile request failed (${profileResponse.status})`);
      const profile = await profileResponse.json();
      db.prepare(`INSERT INTO users (discord_id, discord_username) VALUES (?, ?)
        ON CONFLICT(discord_id) DO UPDATE SET discord_username = excluded.discord_username`).run(profile.id, profile.global_name || profile.username);
      const user = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(profile.id);
      const privilegedUsers = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE discord_id != 'demo-dispatch' AND role IN ('LEO','EMS','DISPATCH','ADMIN')`).get().count;
      const realUsers = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE discord_id != 'demo-dispatch'`).get().count;
      if (privilegedUsers === 0 && realUsers === 1) db.prepare(`UPDATE users SET role='ADMIN' WHERE id=?`).run(user.id);
      db.prepare(`INSERT INTO audit_logs (user_id,actor_name,action,entity_type,entity_id,details,ip_address) VALUES (?,?,?,?,?,?,?)`)
        .run(user.id, profile.global_name || profile.username, 'AUTH_LOGIN', 'SESSION', String(user.id), JSON.stringify({ provider: 'Discord' }), req.ip);
      req.session.userId = user.id;
      res.redirect(config.frontendUrl);
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
    req.session.destroy(error => error ? next(error) : res.status(204).end());
  });
}
