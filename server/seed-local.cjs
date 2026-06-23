try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'oee_central.sqlite');

async function seed() {
  console.log('[SQLite Seed] Memulai seeding database lokal...');
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  // Skema Tabel
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
      plan_count INTEGER DEFAULT 0,
      planned_time_sec INTEGER DEFAULT 0,
      run_time_sec INTEGER DEFAULT 0,
      speedloss_sec INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS downtime_events (
      id TEXT PRIMARY KEY,
      station_id TEXT REFERENCES stations(id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, role)
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

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Hapus data lama jika ada (urutan FK: child dulu baru parent)
  // Disable FK during cleanup to handle legacy FK references
  await db.exec(`PRAGMA foreign_keys = OFF`);
  const cleanTables = ['ng_defects','wo_stations','work_orders','products','alerts','downtime_events','oee_snapshots','edge_nodes','api_tokens','sessions','user_roles','stations','lines','production_sections','profiles'];
  for (const t of cleanTables) {
    try { await db.exec('DELETE FROM ' + t); } catch (_) {}
  }
  await db.exec(`PRAGMA foreign_keys = ON`);

  // ── production_sections ──
  await db.run("INSERT INTO production_sections (id, name, sort_order, created_at, target_oee) VALUES (?, ?, ?, ?, ?)",
    ['5d95b697-216b-4f66-b498-474183d083f9', 'CCU', 999, '2026-06-22 17:13:14', 0.85]);

  // ── lines ──
  await db.run("INSERT INTO lines (id, production_section_id, name, target_oee, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ['10e87f40-e312-4c86-b271-d9745490bfad', '5d95b697-216b-4f66-b498-474183d083f9', 'Final Assy', 0.85, 999, '2026-06-22 17:13:39']);

  // ── stations ──
  await db.run("INSERT INTO stations (id, line_id, name, target_oee, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ['63be1991-462f-41f7-8a99-f411dde7b3ca', '10e87f40-e312-4c86-b271-d9745490bfad', 'Label Paste', 0.85, 999, '2026-06-22 17:13:51']);
  await db.run("INSERT INTO stations (id, line_id, name, target_oee, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ['ba25123f-8d1e-4283-b0c9-bc07682d336a', '10e87f40-e312-4c86-b271-d9745490bfad', 'Final Function', 0.85, 999, '2026-06-22 17:14:17']);

  // ── profiles ──
  const adminId = 'e8e341e7-88d1-4a26-8417-5f68dfaa92a0';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync('admin123', salt, 100000, 64, 'sha512').toString('hex');
  const pwdHash = salt + ':' + hash;
  await db.run("INSERT INTO profiles (id, full_name, password_hash, line_id, created_at, updated_at, username, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [adminId, 'admin@incl.com', pwdHash, null, '2026-06-22 16:55:47', '2026-06-22 16:55:47', 'admin', 'admin@oee.com']);

  // ── user_roles ──
  await db.run("INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    ['119d8d49-df5b-4ae5-b436-b470a7a939a3', adminId, 'admin', '2026-06-22 16:55:47']);

  // ── products ──
  await db.run("INSERT INTO products (id, code, name, model, serial_prefix, cycle_time_sec, ng_target_ratio, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['prod-d52', 'D52-H5810-03-00-80', 'CCU Module D52-03', 'D52-03', '0008', 45, 0.0005, 1, '2026-06-22 16:55:47', '2026-06-22 16:55:47']);
  await db.run("INSERT INTO products (id, code, name, model, serial_prefix, cycle_time_sec, ng_target_ratio, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['prod-dh7', 'DH7-H5810-00-00-80', 'CCU Module DH7-01', 'DH7-00', '0020', 55, 0.0005, 1, '2026-06-22 16:55:47', '2026-06-22 16:55:47']);

  // ── work_orders ──
  const woId = 'a86b0836-f40a-466b-848e-27636fb69d83';
  await db.run("INSERT INTO work_orders (id, wo_number, product_id, line_id, planned_qty, planned_start, planned_end, status, created_by, created_at, updated_at, actual_qty, ng_qty, station_ids, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [woId, 'WO-20260623-0001', 'prod-d52', '10e87f40-e312-4c86-b271-d9745490bfad', 100, '2026-06-23T02:30:00.000Z', '2026-06-23T11:30:00.000Z', 'open', adminId, '2026-06-23 06:10:51', '2026-06-23 06:10:51', 0, 0, JSON.stringify(['ba25123f-8d1e-4283-b0c9-bc07682d336a', '63be1991-462f-41f7-8a99-f411dde7b3ca']), adminId]);

  // ── wo_stations ──
  await db.run("INSERT INTO wo_stations (id, work_order_id, station_id, job_card_number, status, actual_qty, ng_qty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['9e93a81f-87cb-4c1f-9add-6203c25be0a2', woId, 'ba25123f-8d1e-4283-b0c9-bc07682d336a', 'WO-20260623-0001/1', 'pending', 0, 0, 0, '2026-06-23 06:10:51', '2026-06-23 06:10:51']);
  await db.run("INSERT INTO wo_stations (id, work_order_id, station_id, job_card_number, status, actual_qty, ng_qty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['07d15579-f586-41a8-8985-52dde4d91116', woId, '63be1991-462f-41f7-8a99-f411dde7b3ca', 'WO-20260623-0001/2', 'pending', 0, 0, 1, '2026-06-23 06:10:51', '2026-06-23 06:10:51']);

  // ── api_tokens ──
  await db.run("INSERT INTO api_tokens (id, token, label, node_name, station_id, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ['7648b532-b030-4b28-b2f8-854185574552', 'oee_fff79c4cc3c5a17e8352c62f38c4bb613f0cc137e81b2b2b', 'LABEL_PASTE', 'LABEL_PASTE', '63be1991-462f-41f7-8a99-f411dde7b3ca', 'read,write', '2026-06-23 06:09:25', '2026-06-23 06:09:25']);
  await db.run("INSERT INTO api_tokens (id, token, label, node_name, station_id, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ['4fdedbf5-dd0a-4d6b-b1aa-7156fda80877', 'oee_88c4a320ef251d013b0c5cc4ca4167863c455e1ee175c0d4', 'FINAL_FUNCTION', 'FINAL_FUNCTION', 'ba25123f-8d1e-4283-b0c9-bc07682d336a', 'read,write', '2026-06-23 06:09:25', '2026-06-23 06:09:25']);

  console.log('[SQLite Seed] Seeding selesai sukses!');
}

seed().catch(console.error);
