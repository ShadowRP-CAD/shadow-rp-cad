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
    CREATE TABLE IF NOT EXISTS call_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER NOT NULL REFERENCES active_calls(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bolos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bolo_type TEXT NOT NULL CHECK(bolo_type IN ('PERSON','VEHICLE','PROPERTY','GENERAL')),
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'P2' CHECK(priority IN ('P0','P1','P2','P3')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','LOCATED','EXPIRED','CANCELLED')),
      location_grid TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      expires_at TEXT,
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
    CREATE TABLE IF NOT EXISTS link_onboarding (
      reforger_uid TEXT PRIMARY KEY,
      player_name TEXT NOT NULL,
      prompted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      linked_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      completed_at TEXT
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
    CREATE TABLE IF NOT EXISTS market_assets (
      symbol TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      sector TEXT NOT NULL,
      description TEXT NOT NULL,
      accent TEXT NOT NULL,
      base_price REAL NOT NULL CHECK(base_price > 0),
      volatility REAL NOT NULL DEFAULT 0.02,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS market_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL REFERENCES market_assets(symbol) ON DELETE CASCADE,
      price REAL NOT NULL CHECK(price > 0),
      volume INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS economy_accounts (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      cash_balance REAL NOT NULL DEFAULT 25000 CHECK(cash_balance >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS atm_bank_state (
      reforger_uid TEXT PRIMARY KEY,
      observed_balance INTEGER NOT NULL DEFAULT 0 CHECK(observed_balance >= 0),
      pending_delta INTEGER NOT NULL DEFAULT 0,
      target_balance INTEGER CHECK(target_balance IS NULL OR target_balance >= 0),
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS market_holdings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL REFERENCES market_assets(symbol) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      average_cost REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id, symbol)
    );
    CREATE TABLE IF NOT EXISTS market_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL REFERENCES market_assets(symbol),
      side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      price REAL NOT NULL CHECK(price > 0),
      total REAL NOT NULL CHECK(total > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bank_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transaction_type TEXT NOT NULL,
      amount REAL NOT NULL,
      memo TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS civilian_properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_name TEXT NOT NULL,
      property_type TEXT NOT NULL,
      location_grid TEXT NOT NULL,
      declared_value REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'REGISTERED',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS civilian_businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_name TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS civilian_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_type TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SUBMITTED',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(last_name, first_name);
    CREATE INDEX IF NOT EXISTS idx_calls_status ON active_calls(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_call_events_call_time ON call_events(call_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bolos_status_priority ON bolos(status, priority, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_units_updated ON units(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tokens_expiry ON link_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_market_prices_symbol_time ON market_prices(symbol, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_market_orders_user_time ON market_orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_atm_bank_state_seen ON atm_bank_state(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bank_transactions_user_time ON bank_transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_civilian_requests_user_time ON civilian_requests(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
  `);
  const characterColumns = db.prepare('PRAGMA table_info(characters)').all();
  if (!characterColumns.some(column => column.name === 'alias')) db.exec('ALTER TABLE characters ADD COLUMN alias TEXT');
  db.exec(`UPDATE characters SET alias = trim(first_name || ' ' || last_name) WHERE alias IS NULL OR trim(alias) = ''`);
  const callColumns = db.prepare('PRAGMA table_info(active_calls)').all();
  if (!callColumns.some(column => column.name === 'priority')) db.exec(`ALTER TABLE active_calls ADD COLUMN priority TEXT NOT NULL DEFAULT 'P2'`);
  if (!callColumns.some(column => column.name === 'call_type')) db.exec(`ALTER TABLE active_calls ADD COLUMN call_type TEXT NOT NULL DEFAULT 'GENERAL'`);
  if (!callColumns.some(column => column.name === 'disposition')) db.exec(`ALTER TABLE active_calls ADD COLUMN disposition TEXT`);
  return db;
}

export function seedDatabase(db, { demo = true } = {}) {
  const exists = db.prepare('SELECT id FROM users WHERE discord_id = ?').get('demo-dispatch');
  if (demo && !exists) {
    const user = db.prepare(`INSERT INTO users (discord_id, discord_username, reforger_uid, role) VALUES (?, ?, ?, ?)`)
      .run('demo-dispatch', 'ShadowDispatch', 'demo-unit-1', 'ADMIN');
    const c1 = db.prepare(`INSERT INTO characters (user_id, first_name, last_name, alias, dob, gender, driver_license, firearm_license, warrants, priors)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.lastInsertRowid, 'Night', '', 'Night', '1992-04-18', 'Unspecified', 'VALID', 'CLASS_A', JSON.stringify(['FTA - speeding']), JSON.stringify(['2024-02-10: Reckless driving']));
    db.prepare(`INSERT INTO vehicles (plate, model, owner_id, is_stolen, color) VALUES (?, ?, ?, ?, ?)`)
      .run('SRP-104', 'M1025 Utility Vehicle', c1.lastInsertRowid, 0, 'Midnight Black');
    db.prepare(`INSERT INTO active_calls (call_title, caller_name, location_grid, world_x, world_z, description) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('Suspicious vehicle', 'Anonymous', '042 067', 4200, 6700, 'Dark vehicle circling the fuel station.');
    db.prepare(`INSERT INTO bolos (bolo_type,subject,description,priority,location_grid,created_by) VALUES (?,?,?,?,?,?)`)
      .run('VEHICLE', 'Black off-road vehicle · Partial plate SRP', 'Wanted for questioning in connection with repeated fuel station surveillance.', 'P1', '042 067', user.lastInsertRowid);
    db.prepare(`INSERT INTO units (reforger_uid, player_name, callsign, agency, rank, duty_status, world_x, world_z, location_grid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('demo-unit-1', 'Wraith', '1-L-12', 'LEO', 'Deputy', '10-8', 3900, 6400, '039 064');
  }

  const assets = [
    ['SHDW','Shadow Industries','Technology','Secure communications, surveillance, and municipal data systems.','#00d9ff',148.25,0.018],
    ['VYPR','Vyper Motors','Automotive','Performance vehicles and fleet contracts across the island.','#b56cff',82.40,0.026],
    ['AERO','Everon Aerospace','Industrial','Rotorcraft maintenance, logistics, and precision components.','#ff9f43',116.80,0.021],
    ['MEDX','Medix Response','Healthcare','Emergency medical equipment and private response services.','#3be38f',64.15,0.014],
    ['NOVA','Nova Energy','Energy','Grid infrastructure, fuel distribution, and renewables.','#ffd166',93.70,0.019],
    ['CRWN','Crown Holdings','Finance','Private banking, insurance, and commercial real estate.','#ff5f8f',205.30,0.012]
  ];
  const insertAsset = db.prepare(`INSERT OR IGNORE INTO market_assets (symbol, company_name, sector, description, accent, base_price, volatility) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertPrice = db.prepare(`INSERT INTO market_prices (symbol, price, volume, recorded_at) VALUES (?, ?, ?, ?)`);
  for (const asset of assets) {
    insertAsset.run(...asset);
    const hasPrice = db.prepare('SELECT 1 FROM market_prices WHERE symbol = ? LIMIT 1').get(asset[0]);
    if (!hasPrice) {
      let price = asset[5] * (0.94 + Math.random() * 0.08);
      for (let hour = 23; hour >= 0; hour--) {
        price = Math.max(1, price * (1 + (Math.random() - 0.48) * asset[6]));
        insertPrice.run(asset[0], Number(price.toFixed(2)), Math.floor(800 + Math.random() * 7200), new Date(Date.now() - hour * 3600000).toISOString());
      }
    }
  }
}
