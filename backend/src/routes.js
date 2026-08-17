import crypto from 'node:crypto';
import express from 'express';
import { requireAuth, requireInternal, requireRole } from './auth.js';

const parseJson = value => { try { return JSON.parse(value || '[]'); } catch { return []; } };
const cleanString = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const cadRoles = ['LEO', 'EMS', 'DISPATCH', 'ADMIN'];

function rowToCharacter(row) {
  return row && { ...row, alias: row.alias || `${row.first_name} ${row.last_name}`.trim(), warrants: parseJson(row.warrants), priors: parseJson(row.priors) };
}

function rowToCall(row) {
  return row && { ...row, assigned_units: parseJson(row.assigned_units) };
}

function ensureEconomyAccount(db, userId) {
  db.prepare('INSERT OR IGNORE INTO economy_accounts (user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM economy_accounts WHERE user_id = ?').get(userId);
}

function advanceMarket(db) {
  const assets = db.prepare('SELECT * FROM market_assets WHERE is_active = 1').all();
  const latest = db.prepare('SELECT price, recorded_at FROM market_prices WHERE symbol = ? ORDER BY id DESC LIMIT 1');
  const insert = db.prepare('INSERT INTO market_prices (symbol, price, volume) VALUES (?, ?, ?)');
  for (const asset of assets) {
    const tick = latest.get(asset.symbol);
    if (!tick || db.prepare(`SELECT datetime(?) <= datetime('now', '-2 minutes') AS due`).get(tick.recorded_at).due) {
      const drift = (Math.random() - 0.485) * asset.volatility;
      const next = Math.max(1, tick.price * (1 + drift));
      insert.run(asset.symbol, Number(next.toFixed(2)), Math.floor(250 + Math.random() * 2600));
    }
  }
}

function marketSnapshot(db, userId) {
  advanceMarket(db);
  const account = ensureEconomyAccount(db, userId);
  const assets = db.prepare(`SELECT a.*,
    (SELECT price FROM market_prices p WHERE p.symbol=a.symbol ORDER BY p.id DESC LIMIT 1) AS price,
    (SELECT price FROM market_prices p WHERE p.symbol=a.symbol ORDER BY p.id DESC LIMIT 1 OFFSET 1) AS previous_price,
    (SELECT SUM(volume) FROM market_prices p WHERE p.symbol=a.symbol AND datetime(p.recorded_at) >= datetime('now','-24 hours')) AS day_volume
    FROM market_assets a WHERE a.is_active=1 ORDER BY a.symbol`).all().map(asset => ({
      ...asset,
      change: Number((((asset.price - (asset.previous_price || asset.price)) / (asset.previous_price || asset.price)) * 100).toFixed(2)),
      history: db.prepare('SELECT price, recorded_at FROM market_prices WHERE symbol=? ORDER BY id DESC LIMIT 24').all(asset.symbol).reverse()
    }));
  const holdings = db.prepare(`SELECT h.symbol, h.quantity, h.average_cost,
    (SELECT price FROM market_prices p WHERE p.symbol=h.symbol ORDER BY p.id DESC LIMIT 1) AS price
    FROM market_holdings h WHERE h.user_id=? AND h.quantity>0 ORDER BY h.symbol`).all(userId);
  const orders = db.prepare('SELECT * FROM market_orders WHERE user_id=? ORDER BY id DESC LIMIT 20').all(userId);
  const holdingsValue = holdings.reduce((sum, item) => sum + item.quantity * item.price, 0);
  return { assets, holdings, orders, account: { cash: account.cash_balance, holdingsValue, netWorth: account.cash_balance + holdingsValue } };
}

export function createApiRouter(db, events) {
  const router = express.Router();

  router.get('/health', (_req, res) => res.json({ ok: true, service: 'shadow-rp-cad', time: new Date().toISOString() }));
  router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

  router.post('/link/generate', requireInternal, (req, res) => {
    const reforgerUid = cleanString(req.body.reforgerUid, 128);
    const playerName = cleanString(req.body.playerName, 80);
    if (!reforgerUid || !playerName) return res.status(400).json({ error: 'reforgerUid and playerName are required' });
    db.prepare('DELETE FROM link_tokens WHERE reforger_uid = ? OR expires_at <= CURRENT_TIMESTAMP').run(reforgerUid);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let token;
    do token = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    while (db.prepare('SELECT 1 FROM link_tokens WHERE token = ?').get(token));
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    db.prepare('INSERT INTO link_tokens (token, reforger_uid, player_name, expires_at) VALUES (?, ?, ?, ?)').run(token, reforgerUid, playerName, expiresAt);
    res.status(201).json({ token, expiresAt });
  });

  router.post('/link/verify', requireAuth, (req, res) => {
    const token = cleanString(req.body.token, 6).toUpperCase();
    const steamId = cleanString(req.body.steamId, 32) || null;
    const record = db.prepare('SELECT * FROM link_tokens WHERE token = ? AND used_at IS NULL AND expires_at > ?').get(token, new Date().toISOString());
    if (!record) return res.status(400).json({ error: 'Code is invalid or expired' });
    const conflict = db.prepare('SELECT id FROM users WHERE reforger_uid = ? AND id != ?').get(record.reforger_uid, req.user.id);
    if (conflict) return res.status(409).json({ error: 'This Reforger identity is already linked' });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET reforger_uid = ?, steam_id = COALESCE(?, steam_id) WHERE id = ?').run(record.reforger_uid, steamId, req.user.id);
      db.prepare('UPDATE link_tokens SET used_at = CURRENT_TIMESTAMP WHERE token = ?').run(token);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ linked: true, reforgerUid: record.reforger_uid, playerName: record.player_name });
  });

  router.post('/cad/call911', requireInternal, (req, res) => {
    const title = cleanString(req.body.callTitle || 'Emergency call', 100);
    const caller = cleanString(req.body.callerName, 80);
    const grid = cleanString(req.body.locationGrid, 32);
    const description = cleanString(req.body.description, 1000);
    if (!caller || !grid || !description) return res.status(400).json({ error: 'callerName, locationGrid, and description are required' });
    const result = db.prepare(`INSERT INTO active_calls (call_title, caller_name, location_grid, world_x, world_z, description)
      VALUES (?, ?, ?, ?, ?, ?)`).run(title, caller, grid, Number(req.body.worldX) || null, Number(req.body.worldZ) || null, description);
    const call = rowToCall(db.prepare('SELECT * FROM active_calls WHERE id = ?').get(result.lastInsertRowid));
    events.broadcast('call.created', call);
    res.status(201).json(call);
  });

  router.post('/cad/unit-status', requireInternal, (req, res) => {
    const uid = cleanString(req.body.reforgerUid, 128);
    const name = cleanString(req.body.playerName, 80);
    const callsign = cleanString(req.body.callsign, 24);
    const agency = cleanString(req.body.agency, 16).toUpperCase();
    const status = cleanString(req.body.dutyStatus, 16).toUpperCase();
    if (!uid || !name || !callsign || !['LEO','EMS','FIRE','DISPATCH'].includes(agency)) return res.status(400).json({ error: 'Valid identity, callsign, and agency are required' });
    db.prepare(`INSERT INTO units (reforger_uid, player_name, callsign, agency, rank, duty_status, world_x, world_z, location_grid, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(reforger_uid) DO UPDATE SET player_name=excluded.player_name, callsign=excluded.callsign, agency=excluded.agency,
      rank=excluded.rank, duty_status=excluded.duty_status, world_x=excluded.world_x, world_z=excluded.world_z,
      location_grid=excluded.location_grid, updated_at=CURRENT_TIMESTAMP`).run(uid, name, callsign, agency, cleanString(req.body.rank || 'Officer', 40), status || '10-8', Number(req.body.worldX) || null, Number(req.body.worldZ) || null, cleanString(req.body.locationGrid, 32));
    const unit = db.prepare('SELECT * FROM units WHERE reforger_uid = ?').get(uid);
    events.broadcast('unit.updated', unit);
    res.json(unit);
  });

  router.get('/cad/dashboard', requireAuth, requireRole(...cadRoles), (_req, res) => {
    const calls = db.prepare(`SELECT * FROM active_calls WHERE status != 'CLOSED' ORDER BY created_at DESC`).all().map(rowToCall);
    const units = db.prepare(`SELECT * FROM units WHERE datetime(updated_at) > datetime('now', '-30 minutes') ORDER BY callsign`).all();
    res.json({ calls, units });
  });

  router.patch('/cad/calls/:id', requireAuth, requireRole(...cadRoles), (req, res) => {
    const current = db.prepare('SELECT * FROM active_calls WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Call not found' });
    const status = req.body.status && ['OPEN','DISPATCHED','CLOSED'].includes(req.body.status) ? req.body.status : current.status;
    const assigned = Array.isArray(req.body.assignedUnits) ? req.body.assignedUnits.map(v => cleanString(v, 24)).slice(0, 12) : parseJson(current.assigned_units);
    db.prepare('UPDATE active_calls SET status = ?, assigned_units = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, JSON.stringify(assigned), current.id);
    const call = rowToCall(db.prepare('SELECT * FROM active_calls WHERE id = ?').get(current.id));
    events.broadcast('call.updated', call);
    res.json(call);
  });

  router.get('/cad/civilian/lookup', requireAuth, requireRole(...cadRoles), (req, res) => {
    const term = `%${cleanString(req.query.name, 80)}%`;
    const rows = db.prepare(`SELECT c.*, u.discord_username FROM characters c JOIN users u ON u.id=c.user_id
      WHERE c.alias LIKE ? OR c.first_name || ' ' || c.last_name LIKE ? ORDER BY c.alias LIMIT 50`).all(term, term);
    res.json({ results: rows.map(rowToCharacter) });
  });

  router.get('/cad/vehicle/lookup', requireAuth, requireRole(...cadRoles), (req, res) => {
    const term = `%${cleanString(req.query.plate, 20)}%`;
    const rows = db.prepare(`SELECT v.*, COALESCE(c.alias, trim(c.first_name || ' ' || c.last_name)) AS owner_name FROM vehicles v JOIN characters c ON c.id=v.owner_id
      WHERE v.plate LIKE ? ORDER BY v.plate LIMIT 50`).all(term);
    res.json({ results: rows.map(row => ({ ...row, is_stolen: Boolean(row.is_stolen) })) });
  });

  router.get('/characters', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ results: rows.map(rowToCharacter) });
  });

  router.post('/characters', requireAuth, (req, res) => {
    const alias = cleanString(req.body.alias || `${req.body.firstName || ''} ${req.body.lastName || ''}`, 60);
    const dob = cleanString(req.body.dob, 10), gender = cleanString(req.body.gender || 'Unspecified', 30);
    if (!alias || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ error: 'A roleplay alias and valid roleplay date of birth are required' });
    const result = db.prepare('INSERT INTO characters (user_id, first_name, last_name, alias, dob, gender) VALUES (?, ?, ?, ?, ?, ?)').run(req.user.id, alias, '', alias, dob, gender);
    res.status(201).json(rowToCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(result.lastInsertRowid)));
  });

  router.post('/vehicles', requireAuth, (req, res) => {
    const owner = db.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(req.body.ownerId, req.user.id);
    if (!owner) return res.status(403).json({ error: 'Character does not belong to this account' });
    try {
      const result = db.prepare('INSERT INTO vehicles (plate, model, owner_id, color) VALUES (?, ?, ?, ?)').run(cleanString(req.body.plate, 20).toUpperCase(), cleanString(req.body.model, 80), owner.id, cleanString(req.body.color, 30));
      res.status(201).json(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid));
    } catch (error) { if (String(error).includes('UNIQUE')) return res.status(409).json({ error: 'Plate already exists' }); throw error; }
  });

  router.get('/vehicles', requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT v.*, COALESCE(c.alias, trim(c.first_name || ' ' || c.last_name)) AS owner_name
      FROM vehicles v JOIN characters c ON c.id = v.owner_id WHERE c.user_id = ? ORDER BY v.plate`).all(req.user.id);
    res.json({ results: rows.map(row => ({ ...row, is_stolen: Boolean(row.is_stolen) })) });
  });

  router.post('/reports', requireAuth, requireRole(...cadRoles), (req, res) => {
    const type = cleanString(req.body.reportType, 16).toUpperCase();
    if (!['INCIDENT','ARREST','CITATION'].includes(type)) return res.status(400).json({ error: 'Invalid report type' });
    const result = db.prepare(`INSERT INTO reports (report_type, title, narrative, character_id, author_user_id, charges, fine_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(type, cleanString(req.body.title, 120), cleanString(req.body.narrative, 5000), req.body.characterId || null, req.user.id, JSON.stringify(req.body.charges || []), Number(req.body.fineAmount) || null);
    res.status(201).json(db.prepare('SELECT * FROM reports WHERE id = ?').get(result.lastInsertRowid));
  });

  router.get('/market', requireAuth, (req, res) => res.json(marketSnapshot(db, req.user.id)));

  router.post('/market/trade', requireAuth, (req, res) => {
    const symbol = cleanString(req.body.symbol, 8).toUpperCase();
    const side = cleanString(req.body.side, 4).toUpperCase();
    const quantity = Number.parseInt(req.body.quantity, 10);
    if (!['BUY','SELL'].includes(side) || !Number.isInteger(quantity) || quantity < 1 || quantity > 500) return res.status(400).json({ error: 'Choose BUY or SELL and a quantity from 1 to 500' });
    const asset = db.prepare('SELECT * FROM market_assets WHERE symbol=? AND is_active=1').get(symbol);
    if (!asset) return res.status(404).json({ error: 'Market asset not found' });
    advanceMarket(db);
    const price = db.prepare('SELECT price FROM market_prices WHERE symbol=? ORDER BY id DESC LIMIT 1').get(symbol).price;
    const total = Number((price * quantity).toFixed(2));
    db.exec('BEGIN IMMEDIATE');
    try {
      const account = ensureEconomyAccount(db, req.user.id);
      const holding = db.prepare('SELECT * FROM market_holdings WHERE user_id=? AND symbol=?').get(req.user.id, symbol) || { quantity: 0, average_cost: 0 };
      if (side === 'BUY') {
        if (account.cash_balance < total) throw new Error('Insufficient virtual cash');
        const nextQuantity = holding.quantity + quantity;
        const averageCost = ((holding.quantity * holding.average_cost) + total) / nextQuantity;
        db.prepare(`INSERT INTO market_holdings (user_id,symbol,quantity,average_cost) VALUES (?,?,?,?)
          ON CONFLICT(user_id,symbol) DO UPDATE SET quantity=excluded.quantity, average_cost=excluded.average_cost`).run(req.user.id, symbol, nextQuantity, averageCost);
        db.prepare('UPDATE economy_accounts SET cash_balance=cash_balance-?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(total, req.user.id);
      } else {
        if (holding.quantity < quantity) throw new Error('Not enough shares to sell');
        db.prepare('UPDATE market_holdings SET quantity=quantity-? WHERE user_id=? AND symbol=?').run(quantity, req.user.id, symbol);
        db.prepare('UPDATE economy_accounts SET cash_balance=cash_balance+?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(total, req.user.id);
      }
      db.prepare('INSERT INTO market_orders (user_id,symbol,side,quantity,price,total) VALUES (?,?,?,?,?,?)').run(req.user.id, symbol, side, quantity, price, total);
      const impact = Math.min(0.012, quantity / 50000) * (side === 'BUY' ? 1 : -1);
      db.prepare('INSERT INTO market_prices (symbol,price,volume) VALUES (?,?,?)').run(symbol, Number(Math.max(1, price * (1 + impact)).toFixed(2)), quantity);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (['Insufficient virtual cash','Not enough shares to sell'].includes(error.message)) return res.status(409).json({ error: error.message });
      throw error;
    }
    events.broadcast('market.trade', { symbol, side, quantity });
    res.status(201).json(marketSnapshot(db, req.user.id));
  });

  return router;
}
