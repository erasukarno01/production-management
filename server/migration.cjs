try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'oee_central.sqlite');

async function migrate() {
  console.log('[Migration] Starting...');
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  console.log('[Migration] Creating tables...');

  // Migrate old table & column names
  try { await db.exec("DROP TABLE IF EXISTS categories"); } catch (_) {}
  try { await db.exec("ALTER TABLE lines RENAME COLUMN category_id TO production_section_id"); } catch (_) {}

  // Fix legacy FK reference (categories → production_sections) if still present
  try {
    const linesSql = await db.get("SELECT sql FROM sqlite_master WHERE name='lines'");
    if (linesSql && linesSql.sql.includes('REFERENCES categories')) {
      console.log('[Migration] Fixing legacy FK on lines → production_sections...');
      await db.exec("PRAGMA foreign_keys=OFF");
      await db.exec("CREATE TABLE lines_new (id TEXT PRIMARY KEY, production_section_id TEXT REFERENCES production_sections(id) ON DELETE CASCADE, name TEXT NOT NULL, target_oee REAL DEFAULT 0.85, sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
      await db.exec("INSERT INTO lines_new SELECT * FROM lines");
      await db.exec("DROP TABLE lines");
      await db.exec("ALTER TABLE lines_new RENAME TO lines");
      await db.exec("PRAGMA foreign_keys=ON");
      console.log('[Migration] FK fix complete.');
    }
  } catch (_) {}

  await db.exec(`
    CREATE TABLE IF NOT EXISTS production_sections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      target_oee REAL DEFAULT 0.85,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lines (
      id TEXT PRIMARY KEY,
      production_section_id TEXT REFERENCES production_sections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_oee REAL DEFAULT 0.85,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      line_id TEXT REFERENCES lines(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_oee REAL DEFAULT 0.85,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      email TEXT,
      full_name TEXT,
      username TEXT UNIQUE,
      password_hash TEXT,
      line_id TEXT REFERENCES lines(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, role)
    );

    CREATE TABLE IF NOT EXISTS edge_nodes (
      id TEXT PRIMARY KEY,
      node_name TEXT NOT NULL,
      station_id TEXT REFERENCES stations(id) ON DELETE SET NULL,
      line_name TEXT,
      group_category TEXT,
      station_name TEXT,
      version TEXT DEFAULT '1.0',
      status TEXT DEFAULT 'pending',
      last_seen DATETIME,
      config_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      label TEXT,
      node_name TEXT NOT NULL,
      station_id TEXT,
      permissions TEXT DEFAULT 'read,write',
      expires_at DATETIME,
      last_used_at DATETIME,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS oee_snapshots (
      id TEXT PRIMARY KEY,
      station_id TEXT REFERENCES stations(id) ON DELETE CASCADE,
      job_card_id TEXT,
      ts TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      availability REAL NOT NULL,
      performance REAL NOT NULL,
      quality REAL NOT NULL,
      oee REAL NOT NULL,
      total_count INTEGER DEFAULT 0,
      good_count INTEGER DEFAULT 0,
      ng_count INTEGER DEFAULT 0,
      planned_time_sec INTEGER DEFAULT 0,
      run_time_sec INTEGER DEFAULT 0,
      speedloss_sec INTEGER DEFAULT 0,
      plan_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS downtime_events (
      id TEXT PRIMARY KEY,
      station_id TEXT REFERENCES stations(id) ON DELETE CASCADE,
      job_card_id TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMPTZ,
      duration_sec INTEGER,
      category TEXT DEFAULT 'breakdown',
      reason TEXT,
      note TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      station_id TEXT REFERENCES stations(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      oee_value REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      model TEXT,
      serial_prefix TEXT,
      cycle_time_sec REAL DEFAULT 30,
      ng_target_ratio REAL DEFAULT 0.02,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      wo_number TEXT NOT NULL UNIQUE,
      product_id TEXT REFERENCES products(id) ON DELETE RESTRICT,
      line_id TEXT REFERENCES lines(id) ON DELETE RESTRICT,
      station_ids TEXT,
      planned_qty INTEGER DEFAULT 0,
      actual_qty INTEGER DEFAULT 0,
      ng_qty INTEGER DEFAULT 0,
      planned_start DATETIME,
      planned_end DATETIME,
      per REAL,
      otr REAL,
      qr REAL,
      oee REAL,
      status TEXT DEFAULT 'draft',
      created_by TEXT,
      updated_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wo_stations (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      station_id TEXT REFERENCES stations(id) ON DELETE CASCADE,
      job_card_number TEXT,
      status TEXT DEFAULT 'pending',
      actual_start DATETIME,
      actual_end DATETIME,
      actual_qty INTEGER DEFAULT 0,
      ng_qty INTEGER DEFAULT 0,
      operator_id TEXT,
      operator_name TEXT,
      notes TEXT,
      availability REAL,
      performance REAL,
      quality REAL,
      oee REAL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ng_defects (
      id TEXT PRIMARY KEY,
      station_id TEXT REFERENCES stations(id) ON DELETE CASCADE,
      work_order_id TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrations for existing databases
  const migrations = [
    "ALTER TABLE oee_snapshots ADD COLUMN plan_count INTEGER DEFAULT 0",
    "ALTER TABLE oee_snapshots ADD COLUMN job_card_id TEXT",
    "ALTER TABLE profiles ADD COLUMN password_hash TEXT",
    "ALTER TABLE profiles ADD COLUMN username TEXT",
    "ALTER TABLE profiles ADD COLUMN email TEXT",
    "ALTER TABLE downtime_events ADD COLUMN job_card_id TEXT",
    "ALTER TABLE products ADD COLUMN serial_prefix TEXT",
    "ALTER TABLE work_orders ADD COLUMN station_ids TEXT",
    "ALTER TABLE work_orders ADD COLUMN updated_by TEXT",
  ];
  for (const m of migrations) {
    try { await db.exec(m); console.log('[Migration] OK: ' + m.split(' ').slice(0, 4).join(' ')); }
    catch (_) {}
  }

  // Backfill email from id for existing rows
  try { await db.exec("UPDATE profiles SET email = id WHERE email IS NULL AND id LIKE '%@%'"); } catch (_) {}
  try { await db.exec("UPDATE profiles SET email = full_name WHERE email IS NULL"); } catch (_) {}

  await db.close();
  console.log('[Migration] Complete.');
}

migrate().catch(console.error);
