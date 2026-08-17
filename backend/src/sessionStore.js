import session from 'express-session';

export class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    this.getStmt = db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires_at > ?');
    this.setStmt = db.prepare(`INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`);
    this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.cleanupStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  }

  get(sid, callback) {
    try {
      const row = this.getStmt.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) { callback(error); }
  }

  set(sid, value, callback = () => {}) {
    try {
      const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86_400_000;
      this.setStmt.run(sid, JSON.stringify(value), expires);
      if (Math.random() < 0.01) this.cleanupStmt.run(Date.now());
      callback(null);
    } catch (error) { callback(error); }
  }

  destroy(sid, callback = () => {}) {
    try { this.destroyStmt.run(sid); callback(null); } catch (error) { callback(error); }
  }
}
