import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export function createDatabase(filename = config.databasePath) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL UNIQUE,
      discord_username TEXT NOT NULL,
      steam_id TEXT UNIQUE,
      reforger_uid TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'CIVILIAN' CHECK(role IN ('CIVILIAN','LEO','EMS','DISPATCH','ADMIN')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      dob TEXT NOT NULL,
      gender TEXT NOT NULL,
      driver_license TEXT NOT NULL DEFAULT 'VALID',
      firearm_license TEXT NOT NULL DEFAULT 'NONE',
      warrants TEXT NOT NULL DEFAULT '[]',
      priors TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate TEXT NOT NULL UNIQUE COLLATE NOCASE,
      model TEXT NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      is_stolen INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS active_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_title TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      location_grid TEXT NOT NULL,
      world_x REAL,
      world_z REAL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DISPATCHED','CLOSED')),
      assigned_units TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS units (
      reforger_uid TEXT PRIMARY KEY,
      player_name TEXT NOT NULL,
      callsign TEXT NOT NULL,
      agency TEXT NOT NULL CHECK(agency IN ('LEO','EMS','FIRE','DISPATCH')),
      rank TEXT NOT NULL DEFAULT 'Officer',
      duty_status TEXT NOT NULL DEFAULT '10-8',
      world_x REAL,
      world_z REAL,
      location_grid TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS link_tokens (
      token TEXT PRIMARY KEY,
      reforger_uid TEXT NOT NULL,
      player_name TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL CHECK(report_type IN ('INCIDENT','ARREST','CITATION')),
      title TEXT NOT NULL,
      narrative TEXT NOT NULL,
      character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
      author_user_id INTEGER NOT NULL REFERENCES users(id),
      charges TEXT NOT NULL DEFAULT '[]',
      fine_amount REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(last_name, first_name);
    CREATE INDEX IF NOT EXISTS idx_calls_status ON active_calls(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_units_updated ON units(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tokens_expiry ON link_tokens(expires_at);
  `);
  return db;
}

export function seedDatabase(db) {
  const exists = db.prepare('SELECT id FROM users WHERE discord_id = ?').get('demo-dispatch');
  if (exists) return;
  const user = db.prepare(`INSERT INTO users (discord_id, discord_username, role) VALUES (?, ?, ?)`)
    .run('demo-dispatch', 'ShadowDispatch', 'ADMIN');
  const c1 = db.prepare(`INSERT INTO characters (user_id, first_name, last_name, dob, gender, driver_license, firearm_license, warrants, priors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.lastInsertRowid, 'Alex', 'Mercer', '1992-04-18', 'Non-binary', 'VALID', 'CLASS_A', JSON.stringify(['FTA - speeding']), JSON.stringify(['2024-02-10: Reckless driving']));
  db.prepare(`INSERT INTO vehicles (plate, model, owner_id, is_stolen, color) VALUES (?, ?, ?, ?, ?)`)
    .run('SRP-104', 'M1025 Utility Vehicle', c1.lastInsertRowid, 0, 'Black');
  db.prepare(`INSERT INTO active_calls (call_title, caller_name, location_grid, world_x, world_z, description) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('Suspicious vehicle', 'Anonymous', '042 067', 4200, 6700, 'Dark vehicle circling the fuel station.');
  db.prepare(`INSERT INTO units (reforger_uid, player_name, callsign, agency, rank, duty_status, world_x, world_z, location_grid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('demo-unit-1', 'Jordan Blake', '1-L-12', 'LEO', 'Deputy', '10-8', 3900, 6400, '039 064');
}
