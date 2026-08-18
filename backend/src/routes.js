import crypto from 'node:crypto';
import express from 'express';
import { requireAuth, requireInternal, requireRole } from './auth.js';
import { getPublicSunoTracks } from './suno.js';

const parseJson = value => { try { return JSON.parse(value || '[]'); } catch { return []; } };
const cleanString = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const cadRoles = ['LEO', 'EMS', 'DISPATCH', 'ADMIN'];
const priorities = ['P0', 'P1', 'P2', 'P3'];
const dutyStatuses = ['10-8', '10-7', '10-6', '10-23', '10-99'];

function requireLinked(req, res, next) {
  if (!req.user?.reforger_uid) return res.status(409).json({ error: 'Complete the one-time in-game account link to use persistent economy services.', code: 'ACCOUNT_LINK_REQUIRED' });
  next();
}

function audit(db, req, action, entityType, entityId, details = {}) {
  db.prepare(`INSERT INTO audit_logs (user_id,actor_name,action,entity_type,entity_id,details,ip_address) VALUES (?,?,?,?,?,?,?)`)
    .run(req.user?.id || null, req.user?.discord_username || 'Game Server', action, entityType, entityId == null ? null : String(entityId), JSON.stringify(details), req.ip);
}

function rowToCharacter(row) {
  return row && { ...row, alias: row.alias || `${row.first_name} ${row.last_name}`.trim(), warrants: parseJson(row.warrants), priors: parseJson(row.priors) };
}

function rowToCall(row) {
  return row && { ...row, assigned_units: parseJson(row.assigned_units) };
}

function callWithEvents(db, row) {
  const call = rowToCall(row);
  if (!call) return call;
  call.events = db.prepare('SELECT * FROM call_events WHERE call_id=? ORDER BY id DESC LIMIT 30').all(call.id);
  return call;
}

function addCallEvent(db, callId, eventType, message, actorName = 'Game Server') {
  db.prepare('INSERT INTO call_events (call_id,event_type,message,actor_name) VALUES (?,?,?,?)')
    .run(callId, eventType, cleanString(message, 800), cleanString(actorName, 80) || 'System');
}

function ensureEconomyAccount(db, userId, openingBalance = 25000, memo = 'Shadow Bank resident account opened') {
  const initialBalance = Math.max(0, Math.round(Number(openingBalance) || 0));
  const created = db.prepare('INSERT OR IGNORE INTO economy_accounts (user_id, cash_balance) VALUES (?, ?)').run(userId, initialBalance);
  if (created.changes) db.prepare(`INSERT INTO bank_transactions (user_id,transaction_type,amount,memo) VALUES (?,?,?,?)`).run(userId, 'OPENING_BALANCE', initialBalance, memo);
  return db.prepare('SELECT * FROM economy_accounts WHERE user_id = ?').get(userId);
}

function atmStateForUser(db, userId) {
  return db.prepare(`SELECT s.* FROM atm_bank_state s JOIN users u ON u.reforger_uid=s.reforger_uid WHERE u.id=?`).get(userId);
}

function generateLinkToken(db, reforgerUid, playerName) {
  db.prepare('DELETE FROM link_tokens WHERE reforger_uid = ? OR expires_at <= CURRENT_TIMESTAMP').run(reforgerUid);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let token;
  do token = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  while (db.prepare('SELECT 1 FROM link_tokens WHERE token = ?').get(token));
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  db.prepare('INSERT INTO link_tokens (token, reforger_uid, player_name, expires_at) VALUES (?, ?, ?, ?)').run(token, reforgerUid, playerName, expiresAt);
  return { token, expiresAt };
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
  const atmState = atmStateForUser(db, userId);
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
  return { assets, holdings, orders, account: {
    cash: account.cash_balance,
    holdingsValue,
    netWorth: account.cash_balance + holdingsValue,
    bankSource: atmState ? 'ATM_BANK_MANAGER' : 'AWAITING_GAME_SYNC',
    syncedAt: atmState?.last_seen_at || null
  } };
}

export function createApiRouter(db, events) {
  const router = express.Router();

  router.get('/health', (_req, res) => res.json({ ok: true, service: 'shadow-rp-cad', time: new Date().toISOString() }));
  router.get('/music/tracks', async (_req, res) => {
    try {
      const tracks = await getPublicSunoTracks();
      res.set('Cache-Control', 'public, max-age=900, stale-while-revalidate=3600');
      res.json({ profile: 'https://suno.com/@playerv2', tracks });
    } catch (error) {
      console.warn('[Shadow Radio] Public Suno profile unavailable:', error.message);
      res.status(503).json({ error: 'The live Shadow Radio catalog is temporarily unavailable.' });
    }
  });
  router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

  router.post('/link/generate', requireInternal, (req, res) => {
    const reforgerUid = cleanString(req.body.reforgerUid, 128);
    const playerName = cleanString(req.body.playerName, 80);
    if (!reforgerUid || !playerName) return res.status(400).json({ error: 'reforgerUid and playerName are required' });
    res.status(201).json(generateLinkToken(db, reforgerUid, playerName));
  });

  router.post('/link/onboarding', requireInternal, (req, res) => {
    const reforgerUid = cleanString(req.body.reforgerUid, 128);
    const playerName = cleanString(req.body.playerName, 80);
    if (!reforgerUid || !playerName) return res.status(400).json({ error: 'reforgerUid and playerName are required' });
    const linked = db.prepare('SELECT id FROM users WHERE reforger_uid = ?').get(reforgerUid);
    if (linked) return res.json({ linked: true, showPrompt: false });
    const prior = db.prepare('SELECT reforger_uid FROM link_onboarding WHERE reforger_uid = ?').get(reforgerUid);
    if (prior) {
      const activeToken = db.prepare(`SELECT token, expires_at AS expiresAt FROM link_tokens
        WHERE reforger_uid = ? AND used_at IS NULL AND expires_at > ? LIMIT 1`)
        .get(reforgerUid, new Date().toISOString());
      if (activeToken) return res.json({ linked: false, showPrompt: true, ...activeToken });
      const regenerated = generateLinkToken(db, reforgerUid, playerName);
      return res.json({ linked: false, showPrompt: true, ...regenerated });
    }
    const generated = generateLinkToken(db, reforgerUid, playerName);
    db.prepare('INSERT INTO link_onboarding (reforger_uid, player_name) VALUES (?, ?)').run(reforgerUid, playerName);
    res.status(201).json({ linked: false, showPrompt: true, ...generated });
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
      db.prepare(`INSERT INTO link_onboarding (reforger_uid,player_name,linked_user_id,completed_at)
        VALUES (?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(reforger_uid) DO UPDATE SET linked_user_id=excluded.linked_user_id,completed_at=CURRENT_TIMESTAMP`).run(record.reforger_uid, record.player_name, req.user.id);
      const atmState = db.prepare('SELECT observed_balance, target_balance, pending_delta FROM atm_bank_state WHERE reforger_uid=?').get(record.reforger_uid);
      const linkedBalance = atmState ? (atmState.target_balance ?? atmState.observed_balance) + atmState.pending_delta : 0;
      ensureEconomyAccount(db, req.user.id, linkedBalance, atmState ? 'ATM Bank Manager account linked' : 'Awaiting first ATM Bank Manager sync');
      if (atmState) db.prepare('UPDATE economy_accounts SET cash_balance=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(Math.max(0, linkedBalance), req.user.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    audit(db, req, 'ACCOUNT_LINKED', 'USER', req.user.id, { reforgerUid: record.reforger_uid, playerAlias: record.player_name });
    res.json({ linked: true, reforgerUid: record.reforger_uid, playerName: record.player_name });
  });

  router.post('/economy/atm-sync', requireInternal, (req, res) => {
    const reforgerUid = cleanString(req.body.reforgerUid, 128);
    const playerName = cleanString(req.body.playerName, 80);
    const observedBalance = Number(req.body.bankBalance);
    if (!reforgerUid || !playerName || !Number.isInteger(observedBalance) || observedBalance < 0 || observedBalance > 1_000_000_000) {
      return res.status(400).json({ error: 'A valid reforgerUid, playerName, and integer bankBalance are required' });
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO atm_bank_state (reforger_uid,observed_balance,last_seen_at) VALUES (?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(reforger_uid) DO UPDATE SET observed_balance=excluded.observed_balance,last_seen_at=CURRENT_TIMESTAMP`).run(reforgerUid, observedBalance);
      let state = db.prepare('SELECT * FROM atm_bank_state WHERE reforger_uid=?').get(reforgerUid);
      let gameBalance = observedBalance;
      let apply = false;

      if (state.target_balance != null) {
        if (observedBalance === state.target_balance) {
          db.prepare('UPDATE atm_bank_state SET target_balance=NULL WHERE reforger_uid=?').run(reforgerUid);
        } else {
          gameBalance = state.target_balance;
          apply = true;
        }
      } else if (state.pending_delta !== 0) {
        gameBalance = Math.max(0, observedBalance + state.pending_delta);
        apply = gameBalance !== observedBalance;
        db.prepare('UPDATE atm_bank_state SET pending_delta=0,target_balance=? WHERE reforger_uid=?').run(gameBalance, reforgerUid);
      }

      state = db.prepare('SELECT * FROM atm_bank_state WHERE reforger_uid=?').get(reforgerUid);
      const effectiveBalance = Math.max(0, (state.target_balance ?? state.observed_balance) + state.pending_delta);
      const user = db.prepare('SELECT id FROM users WHERE reforger_uid=?').get(reforgerUid);
      if (user) {
        ensureEconomyAccount(db, user.id, effectiveBalance, 'ATM Bank Manager account connected');
        db.prepare('UPDATE economy_accounts SET cash_balance=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(effectiveBalance, user.id);
      }
      db.exec('COMMIT');
      res.json({ linked: Boolean(user), balance: gameBalance, apply, syncedAt: state.last_seen_at });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });

  router.post('/cad/call911', requireInternal, (req, res) => {
    const title = cleanString(req.body.callTitle || 'Emergency call', 100);
    const caller = cleanString(req.body.callerName, 80);
    const grid = cleanString(req.body.locationGrid, 32);
    const description = cleanString(req.body.description, 1000);
    if (!caller || !grid || !description) return res.status(400).json({ error: 'callerName, locationGrid, and description are required' });
    const priority = priorities.includes(cleanString(req.body.priority, 2).toUpperCase()) ? cleanString(req.body.priority, 2).toUpperCase() : 'P1';
    const callType = cleanString(req.body.callType || '911', 32).toUpperCase();
    const result = db.prepare(`INSERT INTO active_calls (call_title, caller_name, location_grid, world_x, world_z, description, priority, call_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(title, caller, grid, Number(req.body.worldX) || null, Number(req.body.worldZ) || null, description, priority, callType);
    addCallEvent(db, result.lastInsertRowid, 'CREATED', `Emergency call received from ${caller}`, 'Game Server');
    const call = callWithEvents(db, db.prepare('SELECT * FROM active_calls WHERE id = ?').get(result.lastInsertRowid));
    events.broadcast('call.created', call);
    res.status(201).json(call);
  });

  router.post('/cad/calls', requireAuth, requireRole(...cadRoles), (req, res) => {
    const title = cleanString(req.body.callTitle, 100);
    const caller = cleanString(req.body.callerName || 'Dispatch initiated', 80);
    const grid = cleanString(req.body.locationGrid, 32);
    const description = cleanString(req.body.description, 1000);
    const priority = priorities.includes(cleanString(req.body.priority, 2).toUpperCase()) ? cleanString(req.body.priority, 2).toUpperCase() : 'P2';
    const callType = cleanString(req.body.callType || 'GENERAL', 32).toUpperCase();
    if (!title || !grid || !description) return res.status(400).json({ error: 'Title, location grid, and description are required' });
    const result = db.prepare(`INSERT INTO active_calls (call_title,caller_name,location_grid,description,priority,call_type)
      VALUES (?,?,?,?,?,?)`).run(title, caller, grid, description, priority, callType);
    addCallEvent(db, result.lastInsertRowid, 'CREATED', `${priority} ${callType} incident created`, req.user.discord_username);
    const call = callWithEvents(db, db.prepare('SELECT * FROM active_calls WHERE id=?').get(result.lastInsertRowid));
    audit(db, req, 'CALL_CREATED', 'CALL', call.id, { priority, callType, grid });
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
    const calls = db.prepare(`SELECT * FROM active_calls WHERE status != 'CLOSED'
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, created_at DESC`).all().map(row => callWithEvents(db, row));
    const units = db.prepare(`SELECT * FROM units WHERE datetime(updated_at) > datetime('now', '-30 minutes') ORDER BY callsign`).all();
    db.prepare(`UPDATE bolos SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE status='ACTIVE' AND expires_at IS NOT NULL AND datetime(expires_at)<=datetime('now')`).run();
    const bolos = db.prepare(`SELECT b.*,u.discord_username AS created_by_name FROM bolos b LEFT JOIN users u ON u.id=b.created_by
      WHERE b.status='ACTIVE' ORDER BY CASE b.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,b.created_at DESC LIMIT 50`).all();
    res.json({ calls, units, bolos, serverTime: new Date().toISOString() });
  });

  router.patch('/cad/calls/:id', requireAuth, requireRole(...cadRoles), (req, res) => {
    const current = db.prepare('SELECT * FROM active_calls WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Call not found' });
    const status = req.body.status && ['OPEN','DISPATCHED','CLOSED'].includes(req.body.status) ? req.body.status : current.status;
    const priority = priorities.includes(req.body.priority) ? req.body.priority : current.priority;
    const callType = cleanString(req.body.callType || current.call_type, 32).toUpperCase();
    const disposition = req.body.disposition == null ? current.disposition : cleanString(req.body.disposition, 120);
    const assigned = Array.isArray(req.body.assignedUnits) ? req.body.assignedUnits.map(v => cleanString(v, 24)).slice(0, 12) : parseJson(current.assigned_units);
    db.prepare('UPDATE active_calls SET status=?,assigned_units=?,priority=?,call_type=?,disposition=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(status, JSON.stringify(assigned), priority, callType, disposition || null, current.id);
    if (status !== current.status) addCallEvent(db, current.id, 'STATUS', `Status changed from ${current.status} to ${status}`, req.user.discord_username);
    if (priority !== current.priority) addCallEvent(db, current.id, 'PRIORITY', `Priority changed from ${current.priority} to ${priority}`, req.user.discord_username);
    const previousAssigned = parseJson(current.assigned_units);
    for (const callsign of assigned.filter(value => !previousAssigned.includes(value))) addCallEvent(db, current.id, 'UNIT_ASSIGNED', `${callsign} assigned to incident`, req.user.discord_username);
    const call = callWithEvents(db, db.prepare('SELECT * FROM active_calls WHERE id = ?').get(current.id));
    audit(db, req, 'CALL_UPDATED', 'CALL', current.id, { status, priority, assignedUnits: assigned });
    events.broadcast('call.updated', call);
    res.json(call);
  });

  router.post('/cad/calls/:id/notes', requireAuth, requireRole(...cadRoles), (req, res) => {
    const call = db.prepare('SELECT * FROM active_calls WHERE id=?').get(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    const note = cleanString(req.body.note, 800);
    if (!note) return res.status(400).json({ error: 'A note is required' });
    addCallEvent(db, call.id, 'NOTE', note, req.user.discord_username);
    const updated = callWithEvents(db, db.prepare('SELECT * FROM active_calls WHERE id=?').get(call.id));
    audit(db, req, 'CALL_NOTE_ADDED', 'CALL', call.id, { note });
    events.broadcast('call.updated', updated);
    res.status(201).json(updated);
  });

  router.patch('/cad/units/:uid', requireAuth, requireRole(...cadRoles), (req, res) => {
    const unit = db.prepare('SELECT * FROM units WHERE reforger_uid=?').get(req.params.uid);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    const dutyStatus = dutyStatuses.includes(cleanString(req.body.dutyStatus, 16).toUpperCase()) ? cleanString(req.body.dutyStatus, 16).toUpperCase() : unit.duty_status;
    const callsign = cleanString(req.body.callsign || unit.callsign, 24);
    db.prepare('UPDATE units SET duty_status=?,callsign=?,updated_at=CURRENT_TIMESTAMP WHERE reforger_uid=?').run(dutyStatus, callsign, unit.reforger_uid);
    const updated = db.prepare('SELECT * FROM units WHERE reforger_uid=?').get(unit.reforger_uid);
    audit(db, req, 'UNIT_STATUS_CHANGED', 'UNIT', unit.reforger_uid, { callsign, dutyStatus });
    events.broadcast('unit.updated', updated);
    res.json(updated);
  });

  router.post('/cad/bolos', requireAuth, requireRole(...cadRoles), (req, res) => {
    const type = cleanString(req.body.boloType, 16).toUpperCase();
    const subject = cleanString(req.body.subject, 120);
    const description = cleanString(req.body.description, 1000);
    const priority = priorities.includes(cleanString(req.body.priority, 2).toUpperCase()) ? cleanString(req.body.priority, 2).toUpperCase() : 'P2';
    const grid = cleanString(req.body.locationGrid, 32) || null;
    const expiresAt = req.body.expiresAt && !Number.isNaN(Date.parse(req.body.expiresAt)) ? new Date(req.body.expiresAt).toISOString() : null;
    if (!['PERSON','VEHICLE','PROPERTY','GENERAL'].includes(type) || !subject || !description) return res.status(400).json({ error: 'Valid BOLO type, subject, and description are required' });
    const result = db.prepare(`INSERT INTO bolos (bolo_type,subject,description,priority,location_grid,created_by,expires_at) VALUES (?,?,?,?,?,?,?)`)
      .run(type, subject, description, priority, grid, req.user.id, expiresAt);
    const bolo = db.prepare(`SELECT b.*,u.discord_username AS created_by_name FROM bolos b LEFT JOIN users u ON u.id=b.created_by WHERE b.id=?`).get(result.lastInsertRowid);
    audit(db, req, 'BOLO_CREATED', 'BOLO', bolo.id, { type, subject, priority });
    events.broadcast('bolo.created', bolo);
    res.status(201).json(bolo);
  });

  router.patch('/cad/bolos/:id', requireAuth, requireRole(...cadRoles), (req, res) => {
    const current = db.prepare('SELECT * FROM bolos WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'BOLO not found' });
    const status = ['ACTIVE','LOCATED','EXPIRED','CANCELLED'].includes(req.body.status) ? req.body.status : current.status;
    const priority = priorities.includes(req.body.priority) ? req.body.priority : current.priority;
    db.prepare('UPDATE bolos SET status=?,priority=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, priority, current.id);
    const bolo = db.prepare(`SELECT b.*,u.discord_username AS created_by_name FROM bolos b LEFT JOIN users u ON u.id=b.created_by WHERE b.id=?`).get(current.id);
    audit(db, req, 'BOLO_UPDATED', 'BOLO', current.id, { status, priority });
    events.broadcast('bolo.updated', bolo);
    res.json(bolo);
  });

  router.get('/cad/global-search', requireAuth, requireRole(...cadRoles), (req, res) => {
    const query = cleanString(req.query.q, 80);
    if (query.length < 2) return res.json({ people: [], vehicles: [], reports: [], bolos: [] });
    const term = `%${query}%`;
    const people = db.prepare(`SELECT c.id,c.alias,c.dob,c.driver_license,c.firearm_license,c.warrants,c.priors FROM characters c
      WHERE c.alias LIKE ? OR c.first_name||' '||c.last_name LIKE ? ORDER BY c.alias LIMIT 8`).all(term, term).map(rowToCharacter);
    const vehicles = db.prepare(`SELECT v.id,v.plate,v.model,v.color,v.is_stolen,COALESCE(c.alias,trim(c.first_name||' '||c.last_name)) owner_name
      FROM vehicles v JOIN characters c ON c.id=v.owner_id WHERE v.plate LIKE ? OR v.model LIKE ? ORDER BY v.plate LIMIT 8`).all(term, term).map(row => ({ ...row, is_stolen: Boolean(row.is_stolen) }));
    const reports = db.prepare(`SELECT r.id,r.report_type,r.title,r.created_at,u.discord_username FROM reports r JOIN users u ON u.id=r.author_user_id
      WHERE r.title LIKE ? OR r.narrative LIKE ? ORDER BY r.id DESC LIMIT 8`).all(term, term);
    const bolos = db.prepare(`SELECT * FROM bolos WHERE subject LIKE ? OR description LIKE ? ORDER BY id DESC LIMIT 8`).all(term, term);
    res.json({ people, vehicles, reports, bolos });
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
    const character = rowToCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(result.lastInsertRowid));
    audit(db, req, 'PERSONA_CREATED', 'PERSONA', result.lastInsertRowid, { alias });
    res.status(201).json(character);
  });

  router.post('/vehicles', requireAuth, (req, res) => {
    const owner = db.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(req.body.ownerId, req.user.id);
    if (!owner) return res.status(403).json({ error: 'Character does not belong to this account' });
    try {
      const result = db.prepare('INSERT INTO vehicles (plate, model, owner_id, color) VALUES (?, ?, ?, ?)').run(cleanString(req.body.plate, 20).toUpperCase(), cleanString(req.body.model, 80), owner.id, cleanString(req.body.color, 30));
      const created = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);
      audit(db, req, 'VEHICLE_REGISTERED', 'VEHICLE', result.lastInsertRowid, { plate: created.plate, model: created.model });
      res.status(201).json(created);
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
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(result.lastInsertRowid);
    audit(db, req, 'REPORT_FILED', 'REPORT', result.lastInsertRowid, { reportType: type, title: report.title });
    res.status(201).json(report);
  });

  router.get('/market', requireAuth, (req, res) => {
    if (!req.user.reforger_uid) {
      advanceMarket(db);
      const assets = db.prepare(`SELECT a.*,
        (SELECT price FROM market_prices p WHERE p.symbol=a.symbol ORDER BY p.id DESC LIMIT 1) AS price,
        (SELECT price FROM market_prices p WHERE p.symbol=a.symbol ORDER BY p.id DESC LIMIT 1 OFFSET 1) AS previous_price,
        (SELECT SUM(volume) FROM market_prices p WHERE p.symbol=a.symbol AND datetime(p.recorded_at) >= datetime('now','-24 hours')) AS day_volume
        FROM market_assets a WHERE a.is_active=1 ORDER BY a.symbol`).all().map(asset => ({ ...asset, change: Number((((asset.price-(asset.previous_price||asset.price))/(asset.previous_price||asset.price))*100).toFixed(2)), history: [] }));
      return res.json({ assets, holdings: [], orders: [], account: null, linkRequired: true });
    }
    res.json({ ...marketSnapshot(db, req.user.id), linkRequired: false });
  });

  router.post('/market/trade', requireAuth, requireLinked, (req, res) => {
    const symbol = cleanString(req.body.symbol, 8).toUpperCase();
    const side = cleanString(req.body.side, 4).toUpperCase();
    const quantity = Number.parseInt(req.body.quantity, 10);
    if (!['BUY','SELL'].includes(side) || !Number.isInteger(quantity) || quantity < 1 || quantity > 500) return res.status(400).json({ error: 'Choose BUY or SELL and a quantity from 1 to 500' });
    const asset = db.prepare('SELECT * FROM market_assets WHERE symbol=? AND is_active=1').get(symbol);
    if (!asset) return res.status(404).json({ error: 'Market asset not found' });
    advanceMarket(db);
    const price = db.prepare('SELECT price FROM market_prices WHERE symbol=? ORDER BY id DESC LIMIT 1').get(symbol).price;
    const total = Math.max(1, Math.round(price * quantity));
    db.exec('BEGIN IMMEDIATE');
    try {
      const atmState = atmStateForUser(db, req.user.id);
      if (!atmState) throw new Error('ATM bank has not synced. Join the game server before trading.');
      const account = ensureEconomyAccount(db, req.user.id);
      const holding = db.prepare('SELECT * FROM market_holdings WHERE user_id=? AND symbol=?').get(req.user.id, symbol) || { quantity: 0, average_cost: 0 };
      if (side === 'BUY') {
        if (account.cash_balance < total) throw new Error('Insufficient virtual cash');
        const nextQuantity = holding.quantity + quantity;
        const averageCost = ((holding.quantity * holding.average_cost) + total) / nextQuantity;
        db.prepare(`INSERT INTO market_holdings (user_id,symbol,quantity,average_cost) VALUES (?,?,?,?)
          ON CONFLICT(user_id,symbol) DO UPDATE SET quantity=excluded.quantity, average_cost=excluded.average_cost`).run(req.user.id, symbol, nextQuantity, averageCost);
        db.prepare('UPDATE economy_accounts SET cash_balance=cash_balance-?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(total, req.user.id);
        db.prepare('UPDATE atm_bank_state SET pending_delta=pending_delta-? WHERE reforger_uid=?').run(total, req.user.reforger_uid);
      } else {
        if (holding.quantity < quantity) throw new Error('Not enough shares to sell');
        db.prepare('UPDATE market_holdings SET quantity=quantity-? WHERE user_id=? AND symbol=?').run(quantity, req.user.id, symbol);
        db.prepare('UPDATE economy_accounts SET cash_balance=cash_balance+?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(total, req.user.id);
        db.prepare('UPDATE atm_bank_state SET pending_delta=pending_delta+? WHERE reforger_uid=?').run(total, req.user.reforger_uid);
      }
      db.prepare('INSERT INTO market_orders (user_id,symbol,side,quantity,price,total) VALUES (?,?,?,?,?,?)').run(req.user.id, symbol, side, quantity, price, total);
      db.prepare('INSERT INTO bank_transactions (user_id,transaction_type,amount,memo) VALUES (?,?,?,?)').run(req.user.id, side === 'BUY' ? 'STOCK_PURCHASE' : 'STOCK_SALE', side === 'BUY' ? -total : total, `${side} ${quantity} ${symbol} @ $${price.toFixed(2)}`);
      const impact = Math.min(0.012, quantity / 50000) * (side === 'BUY' ? 1 : -1);
      db.prepare('INSERT INTO market_prices (symbol,price,volume) VALUES (?,?,?)').run(symbol, Number(Math.max(1, price * (1 + impact)).toFixed(2)), quantity);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (['Insufficient virtual cash','Not enough shares to sell','ATM bank has not synced. Join the game server before trading.'].includes(error.message)) return res.status(409).json({ error: error.message });
      throw error;
    }
    events.broadcast('market.trade', { symbol, side, quantity });
    audit(db, req, 'MARKET_ORDER', 'MARKET', symbol, { side, quantity, price, total });
    res.status(201).json(marketSnapshot(db, req.user.id));
  });

  router.get('/civilian/portal', requireAuth, (req, res) => {
    const characters = db.prepare('SELECT * FROM characters WHERE user_id=? ORDER BY created_at DESC').all(req.user.id).map(rowToCharacter);
    const vehicles = db.prepare(`SELECT v.*,COALESCE(c.alias,trim(c.first_name||' '||c.last_name)) owner_name FROM vehicles v JOIN characters c ON c.id=v.owner_id WHERE c.user_id=? ORDER BY v.id DESC`).all(req.user.id);
    if (!req.user.reforger_uid) return res.json({ linked: false, characters, vehicles, account: null, holdings: [], properties: [], businesses: [], requests: [], transactions: [] });
    const market = marketSnapshot(db, req.user.id);
    res.json({ linked: true, characters, vehicles, account: market.account, holdings: market.holdings,
      properties: db.prepare('SELECT * FROM civilian_properties WHERE user_id=? ORDER BY id DESC').all(req.user.id),
      businesses: db.prepare('SELECT * FROM civilian_businesses WHERE user_id=? ORDER BY id DESC').all(req.user.id),
      requests: db.prepare('SELECT * FROM civilian_requests WHERE user_id=? ORDER BY id DESC').all(req.user.id),
      transactions: db.prepare('SELECT * FROM bank_transactions WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id)
    });
  });

  router.post('/civilian/properties', requireAuth, requireLinked, (req, res) => {
    const name = cleanString(req.body.propertyName, 80), type = cleanString(req.body.propertyType, 40), grid = cleanString(req.body.locationGrid, 32), value = Math.max(0, Number(req.body.declaredValue) || 0);
    if (!name || !type || !grid) return res.status(400).json({ error: 'Property name, type, and grid are required' });
    const result = db.prepare('INSERT INTO civilian_properties (user_id,property_name,property_type,location_grid,declared_value) VALUES (?,?,?,?,?)').run(req.user.id, name, type, grid, value);
    audit(db, req, 'PROPERTY_REGISTERED', 'PROPERTY', result.lastInsertRowid, { name, type, grid });
    res.status(201).json(db.prepare('SELECT * FROM civilian_properties WHERE id=?').get(result.lastInsertRowid));
  });

  router.post('/civilian/businesses', requireAuth, requireLinked, (req, res) => {
    const name = cleanString(req.body.businessName, 80), category = cleanString(req.body.category, 50);
    if (!name || !category) return res.status(400).json({ error: 'Business name and category are required' });
    const result = db.prepare('INSERT INTO civilian_businesses (user_id,business_name,category) VALUES (?,?,?)').run(req.user.id, name, category);
    audit(db, req, 'BUSINESS_APPLICATION', 'BUSINESS', result.lastInsertRowid, { name, category });
    res.status(201).json(db.prepare('SELECT * FROM civilian_businesses WHERE id=?').get(result.lastInsertRowid));
  });

  router.post('/civilian/requests', requireAuth, requireLinked, (req, res) => {
    const type = cleanString(req.body.requestType, 40), title = cleanString(req.body.title, 100), details = cleanString(req.body.details, 1200);
    if (!type || !title || !details) return res.status(400).json({ error: 'Service, title, and details are required' });
    const result = db.prepare('INSERT INTO civilian_requests (user_id,request_type,title,details) VALUES (?,?,?,?)').run(req.user.id, type, title, details);
    audit(db, req, 'CIVIC_REQUEST_SUBMITTED', 'CIVIC_REQUEST', result.lastInsertRowid, { type, title });
    res.status(201).json(db.prepare('SELECT * FROM civilian_requests WHERE id=?').get(result.lastInsertRowid));
  });

  router.get('/admin/overview', requireAuth, requireRole('ADMIN'), (_req, res) => {
    const users = db.prepare(`SELECT u.*, COALESCE(e.cash_balance,25000) AS cash_balance,
      (SELECT COUNT(*) FROM characters c WHERE c.user_id=u.id) AS persona_count,
      (SELECT COUNT(*) FROM market_orders o WHERE o.user_id=u.id) AS order_count
      FROM users u LEFT JOIN economy_accounts e ON e.user_id=u.id ORDER BY u.created_at DESC`).all();
    const characters = db.prepare(`SELECT c.*, u.discord_username FROM characters c JOIN users u ON u.id=c.user_id ORDER BY c.created_at DESC`).all().map(rowToCharacter);
    const vehicles = db.prepare(`SELECT v.*, COALESCE(c.alias,trim(c.first_name || ' ' || c.last_name)) AS owner_alias, u.discord_username
      FROM vehicles v JOIN characters c ON c.id=v.owner_id JOIN users u ON u.id=c.user_id ORDER BY v.id DESC`).all().map(row => ({ ...row, is_stolen: Boolean(row.is_stolen) }));
    const calls = db.prepare('SELECT * FROM active_calls ORDER BY id DESC LIMIT 250').all().map(rowToCall);
    const reports = db.prepare(`SELECT r.*, u.discord_username, COALESCE(c.alias,trim(c.first_name || ' ' || c.last_name)) AS subject_alias
      FROM reports r JOIN users u ON u.id=r.author_user_id LEFT JOIN characters c ON c.id=r.character_id ORDER BY r.id DESC LIMIT 250`).all().map(row => ({ ...row, charges: parseJson(row.charges) }));
    const orders = db.prepare(`SELECT o.*,u.discord_username FROM market_orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 250`).all();
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 500').all().map(row => ({ ...row, details: parseJson(row.details) }));
    res.json({ users, characters, vehicles, calls, reports, orders, logs, counts: {
      users: users.length, personas: characters.length, vehicles: vehicles.length,
      activeCalls: calls.filter(call => call.status !== 'CLOSED').length, reports: reports.length, orders: orders.length
    }});
  });

  router.patch('/admin/users/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
    const role = cleanString(req.body.role, 16).toUpperCase();
    if (!['CIVILIAN','LEO','EMS','DISPATCH','ADMIN'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (Number(req.params.id) === req.user.id && role !== 'ADMIN') return res.status(400).json({ error: 'You cannot remove your own administrator access' });
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, target.id);
    audit(db, req, 'USER_ROLE_CHANGED', 'USER', target.id, { username: target.discord_username, from: target.role, to: role });
    res.json(db.prepare('SELECT * FROM users WHERE id=?').get(target.id));
  });

  router.patch('/admin/characters/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
    const current = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Persona not found' });
    const alias = cleanString(req.body.alias ?? current.alias, 60), dob = cleanString(req.body.dob ?? current.dob, 10), gender = cleanString(req.body.gender ?? current.gender, 30);
    const driver = cleanString(req.body.driverLicense ?? current.driver_license, 24), firearm = cleanString(req.body.firearmLicense ?? current.firearm_license, 24);
    if (!alias || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ error: 'Valid alias and roleplay DOB required' });
    db.prepare('UPDATE characters SET alias=?,first_name=?,last_name=?,dob=?,gender=?,driver_license=?,firearm_license=? WHERE id=?').run(alias, alias, '', dob, gender, driver, firearm, current.id);
    audit(db, req, 'PERSONA_EDITED', 'PERSONA', current.id, { alias });
    res.json(rowToCharacter(db.prepare('SELECT * FROM characters WHERE id=?').get(current.id)));
  });

  router.delete('/admin/characters/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
    const current = db.prepare('SELECT * FROM characters WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Persona not found' });
    db.prepare('DELETE FROM characters WHERE id=?').run(current.id);
    audit(db, req, 'PERSONA_REMOVED', 'PERSONA', current.id, { alias: current.alias });
    res.status(204).end();
  });

  router.patch('/admin/vehicles/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
    const current = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Vehicle not found' });
    const plate = cleanString(req.body.plate ?? current.plate, 20).toUpperCase(), model = cleanString(req.body.model ?? current.model, 80), color = cleanString(req.body.color ?? current.color, 30);
    const stolen = req.body.isStolen == null ? current.is_stolen : Number(Boolean(req.body.isStolen));
    db.prepare('UPDATE vehicles SET plate=?,model=?,color=?,is_stolen=? WHERE id=?').run(plate, model, color, stolen, current.id);
    audit(db, req, 'VEHICLE_EDITED', 'VEHICLE', current.id, { plate, stolen: Boolean(stolen) });
    res.json({ ...db.prepare('SELECT * FROM vehicles WHERE id=?').get(current.id), is_stolen: Boolean(stolen) });
  });

  router.delete('/admin/vehicles/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
    const current = db.prepare('SELECT * FROM vehicles WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Vehicle not found' });
    db.prepare('DELETE FROM vehicles WHERE id=?').run(current.id);
    audit(db, req, 'VEHICLE_REMOVED', 'VEHICLE', current.id, { plate: current.plate });
    res.status(204).end();
  });

  router.patch('/admin/calls/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
    const current = db.prepare('SELECT * FROM active_calls WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Call not found' });
    const status = ['OPEN','DISPATCHED','CLOSED'].includes(req.body.status) ? req.body.status : current.status;
    db.prepare(`UPDATE active_calls SET call_title=?,caller_name=?,location_grid=?,description=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
      cleanString(req.body.callTitle ?? current.call_title,100), cleanString(req.body.callerName ?? current.caller_name,80), cleanString(req.body.locationGrid ?? current.location_grid,32), cleanString(req.body.description ?? current.description,1000), status, current.id);
    audit(db, req, 'CALL_ADMIN_EDITED', 'CALL', current.id, { status });
    const call = rowToCall(db.prepare('SELECT * FROM active_calls WHERE id=?').get(current.id)); events.broadcast('call.updated', call); res.json(call);
  });

  router.delete('/admin/calls/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
    const current = db.prepare('SELECT * FROM active_calls WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Call not found' });
    db.prepare('DELETE FROM active_calls WHERE id=?').run(current.id); audit(db, req, 'CALL_REMOVED', 'CALL', current.id, { title: current.call_title }); res.status(204).end();
  });

  router.delete('/admin/reports/:id', requireAuth, requireRole('ADMIN'), (req, res) => {
    const current = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Report not found' });
    db.prepare('DELETE FROM reports WHERE id=?').run(current.id); audit(db, req, 'REPORT_REMOVED', 'REPORT', current.id, { title: current.title }); res.status(204).end();
  });

  router.patch('/admin/economy/:userId', requireAuth, requireRole('ADMIN'), (req, res) => {
    const cash = Number(req.body.cashBalance);
    if (!Number.isFinite(cash) || cash < 0 || cash > 100000000) return res.status(400).json({ error: 'Cash balance must be between 0 and 100,000,000' });
    const targetCash = Math.round(cash);
    const user = db.prepare('SELECT id,reforger_uid FROM users WHERE id=?').get(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const atmState = user.reforger_uid && db.prepare('SELECT * FROM atm_bank_state WHERE reforger_uid=?').get(user.reforger_uid);
    if (!atmState) return res.status(409).json({ error: 'This player must join the game once before their ATM balance can be adjusted.' });
    const current = ensureEconomyAccount(db, user.id, atmState.observed_balance);
    const delta = targetCash - current.cash_balance;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE economy_accounts SET cash_balance=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(targetCash, user.id);
      db.prepare('UPDATE atm_bank_state SET pending_delta=pending_delta+? WHERE reforger_uid=?').run(delta, user.reforger_uid);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    audit(db, req, 'ATM_BALANCE_ADJUSTMENT_QUEUED', 'USER', req.params.userId, { previousBalance: current.cash_balance, cashBalance: targetCash, delta });
    res.json({ userId: Number(req.params.userId), cashBalance: targetCash, queuedForAtm: true });
  });

  return router;
}
