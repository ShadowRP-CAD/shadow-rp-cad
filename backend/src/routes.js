import crypto from 'node:crypto';
import express from 'express';
import { requireAuth, requireInternal, requireRole } from './auth.js';

const parseJson = value => { try { return JSON.parse(value || '[]'); } catch { return []; } };
const cleanString = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const cadRoles = ['LEO', 'EMS', 'DISPATCH', 'ADMIN'];

function rowToCharacter(row) {
  return row && { ...row, warrants: parseJson(row.warrants), priors: parseJson(row.priors) };
}

function rowToCall(row) {
  return row && { ...row, assigned_units: parseJson(row.assigned_units) };
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
      WHERE c.first_name || ' ' || c.last_name LIKE ? OR c.last_name || ', ' || c.first_name LIKE ? ORDER BY c.last_name LIMIT 50`).all(term, term);
    res.json({ results: rows.map(rowToCharacter) });
  });

  router.get('/cad/vehicle/lookup', requireAuth, requireRole(...cadRoles), (req, res) => {
    const term = `%${cleanString(req.query.plate, 20)}%`;
    const rows = db.prepare(`SELECT v.*, c.first_name || ' ' || c.last_name AS owner_name FROM vehicles v JOIN characters c ON c.id=v.owner_id
      WHERE v.plate LIKE ? ORDER BY v.plate LIMIT 50`).all(term);
    res.json({ results: rows.map(row => ({ ...row, is_stolen: Boolean(row.is_stolen) })) });
  });

  router.get('/characters', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ results: rows.map(rowToCharacter) });
  });

  router.post('/characters', requireAuth, (req, res) => {
    const first = cleanString(req.body.firstName, 40), last = cleanString(req.body.lastName, 40), dob = cleanString(req.body.dob, 10), gender = cleanString(req.body.gender, 30);
    if (!first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(dob) || !gender) return res.status(400).json({ error: 'Valid firstName, lastName, dob, and gender are required' });
    const result = db.prepare('INSERT INTO characters (user_id, first_name, last_name, dob, gender) VALUES (?, ?, ?, ?, ?)').run(req.user.id, first, last, dob, gender);
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
    const rows = db.prepare(`SELECT v.*, c.first_name || ' ' || c.last_name AS owner_name
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

  return router;
}
