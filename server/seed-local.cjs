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
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lines (
      id TEXT PRIMARY KEY,
      category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
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
  `);

  // Hapus data lama jika ada (urutan FK: child dulu baru parent)
  await db.exec(`PRAGMA foreign_keys = ON`);
  await db.exec(`DELETE FROM alerts`);
  await db.exec(`DELETE FROM downtime_events`);
  await db.exec(`DELETE FROM oee_snapshots`);
  await db.exec(`DELETE FROM edge_nodes`);
  await db.exec(`DELETE FROM api_tokens`);
  await db.exec(`DELETE FROM sessions`);
  await db.exec(`DELETE FROM user_roles`);
  await db.exec(`DELETE FROM stations`);
  await db.exec(`DELETE FROM lines`);
  await db.exec(`DELETE FROM categories`);
  await db.exec(`DELETE FROM profiles`);

  // 1. Categories
  const categories = [
    { id: 'cat-smt', name: 'SMT', sort_order: 1 },
    { id: 'cat-sub-assy', name: 'Sub Assy', sort_order: 2 },
    { id: 'cat-final-assy', name: 'Final Assy', sort_order: 3 }
  ];

  for (const c of categories) {
    await db.run('INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)', [c.id, c.name, c.sort_order]);
  }
  console.log('[SQLite Seed] Berhasil insert Categories.');

  // 2. Lines
  const lines = [
    { id: 'line-smt1', category_id: 'cat-smt', name: 'SMT Line 1', target_oee: 0.85, sort_order: 1 },
    { id: 'line-smt2', category_id: 'cat-smt', name: 'SMT Line 2', target_oee: 0.85, sort_order: 2 },
    { id: 'line-sub-ccu', category_id: 'cat-sub-assy', name: 'Sub Assy CCU', target_oee: 0.80, sort_order: 3 },
    { id: 'line-flash-ccu', category_id: 'cat-sub-assy', name: 'Flashing CCU', target_oee: 0.80, sort_order: 4 },
    { id: 'line-final-ccu1', category_id: 'cat-final-assy', name: 'Final Assy CCU 1', target_oee: 0.85, sort_order: 5 },
    { id: 'line-final-ccu2', category_id: 'cat-final-assy', name: 'Final Assy CCU 2', target_oee: 0.85, sort_order: 6 }
  ];

  for (const l of lines) {
    await db.run('INSERT INTO lines (id, category_id, name, target_oee, sort_order) VALUES (?, ?, ?, ?, ?)', [l.id, l.category_id, l.name, l.target_oee, l.sort_order]);
  }
  console.log('[SQLite Seed] Berhasil insert Lines.');

  // 3. Stations
  const stations = [
    // SMT Line 1
    { id: 'smt1-mounting', name: 'Mounting', line_id: 'line-smt1', target_oee: 0.85, sort_order: 1 },
    { id: 'smt1-aoi', name: 'AOI', line_id: 'line-smt1', target_oee: 0.85, sort_order: 2 },
    // SMT Line 2
    { id: 'smt2-mounting', name: 'Mounting', line_id: 'line-smt2', target_oee: 0.85, sort_order: 3 },
    { id: 'smt2-aoi', name: 'AOI', line_id: 'line-smt2', target_oee: 0.85, sort_order: 4 },
    // Sub Assy CCU
    { id: 'sub-ccu-cutting', name: 'Cutting PCB', line_id: 'line-sub-ccu', target_oee: 0.80, sort_order: 5 },
    { id: 'sub-ccu-soldering', name: 'Soldering Connector', line_id: 'line-sub-ccu', target_oee: 0.80, sort_order: 6 },
    // Flashing CCU
    { id: 'flash-ccu-mcu', name: 'Flashing MCU', line_id: 'line-flash-ccu', target_oee: 0.80, sort_order: 7 },
    { id: 'flash-ccu-coating', name: 'Coating PCB', line_id: 'line-flash-ccu', target_oee: 0.80, sort_order: 8 },
    // Final Assy CCU 1
    { id: 'final1-bt', name: 'BT Program Flashing', line_id: 'line-final-ccu1', target_oee: 0.85, sort_order: 9 },
    { id: 'final1-label', name: 'Label Paste', line_id: 'line-final-ccu1', target_oee: 0.85, sort_order: 10 },
    { id: 'final1-curing', name: 'Curing PU', line_id: 'line-final-ccu1', target_oee: 0.85, sort_order: 11 },
    { id: 'final1-potting', name: 'Potting PU', line_id: 'line-final-ccu1', target_oee: 0.85, sort_order: 12 },
    { id: 'final1-func', name: 'Final Function', line_id: 'line-final-ccu1', target_oee: 0.85, sort_order: 13 },
    // Final Assy CCU 2
    { id: 'final2-bt', name: 'BT Program Flashing', line_id: 'line-final-ccu2', target_oee: 0.85, sort_order: 14 },
    { id: 'final2-label', name: 'Label Paste', line_id: 'line-final-ccu2', target_oee: 0.85, sort_order: 15 },
    { id: 'final2-curing', name: 'Curing PU', line_id: 'line-final-ccu2', target_oee: 0.85, sort_order: 16 },
    { id: 'final2-potting', name: 'Potting PU', line_id: 'line-final-ccu2', target_oee: 0.85, sort_order: 17 },
    { id: 'final2-func', name: 'Final Function', line_id: 'line-final-ccu2', target_oee: 0.85, sort_order: 18 }
  ];

  for (const s of stations) {
    await db.run('INSERT INTO stations (id, line_id, name, target_oee, sort_order) VALUES (?, ?, ?, ?, ?)', [s.id, s.line_id, s.name, s.target_oee, s.sort_order]);
  }
  console.log('[SQLite Seed] Berhasil insert Stations.');

  // 4. Default Admin User (password: admin123)
  const adminId = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync('admin123', salt, 100000, 64, 'sha512').toString('hex');
  const passwordHash = salt + ':' + hash;
  await db.run('INSERT INTO profiles (id, email, full_name, username, password_hash) VALUES (?, ?, ?, ?, ?)', [adminId, 'admin@oee.com', 'admin@oee.com', 'admin', passwordHash]);
  await db.run('INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)', [crypto.randomUUID(), adminId, 'admin']);
  console.log('[SQLite Seed] Default admin account created: admin@oee.com / admin123');

  // 5. Default API Token untuk testing edge node
  const testToken = 'oee_' + crypto.randomBytes(24).toString('hex');
  await db.run('INSERT INTO api_tokens (id, token, label, node_name, station_id) VALUES (?, ?, ?, ?, ?)',
    [crypto.randomUUID(), testToken, 'Default AOI Edge', 'SMT_LINE_1_AOI', 'smt1-aoi']);
  console.log('[SQLite Seed] API token untuk SMT_LINE_1_AOI: ' + testToken);

  // 6. Default API Token untuk semua station
  const stationTokens = [
    { node: 'SMT_LINE_2_AOI', station: 'smt2-aoi' },
    { node: 'SUB_CCU_CUTTING', station: 'sub-ccu-cutting' },
    { node: 'SUB_CCU_SOLDERING', station: 'sub-ccu-soldering' },
    { node: 'FINAL_CCU1_BT', station: 'final1-bt' },
    { node: 'FINAL_CCU2_BT', station: 'final2-bt' },
  ];
  for (const st of stationTokens) {
    const tok = 'oee_' + crypto.randomBytes(24).toString('hex');
    await db.run('INSERT INTO api_tokens (id, token, label, node_name, station_id) VALUES (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), tok, st.node, st.node, st.station]);
    console.log('[SQLite Seed] API token untuk ' + st.node + ': ' + tok);
  }

  // 7. Default Products (with serial_prefix untuk QR matching)
  const products = [
    { id: 'prod-d52', code: 'D52-03', name: 'CCU Module D52-03', model: 'D52-03', serial_prefix: '0008', cycle_time_sec: 45, ng_target_ratio: 0.02 },
    { id: 'prod-dh7', code: 'DH7-01', name: 'CCU Module DH7-01', model: 'DH7-01', serial_prefix: '0020', cycle_time_sec: 55, ng_target_ratio: 0.02 },
    { id: 'prod-x1',  code: 'X1-00',  name: 'CCU Module X1 Standard', model: 'X1',  serial_prefix: '0035', cycle_time_sec: 60, ng_target_ratio: 0.03 },
    { id: 'prod-x2',  code: 'X2-00',  name: 'CCU Module X2 Premium', model: 'X2',  serial_prefix: '0050', cycle_time_sec: 70, ng_target_ratio: 0.02 },
  ];
  for (const p of products) {
    await db.run('INSERT INTO products (id, code, name, model, serial_prefix, cycle_time_sec, ng_target_ratio, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [p.id, p.code, p.name, p.model, p.serial_prefix, p.cycle_time_sec, p.ng_target_ratio]);
  }
  console.log('[SQLite Seed] Berhasil insert ' + products.length + ' Products.');

  // 8. Default Work Orders
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const workOrders = [
    { wo: 'WO-2026-001', product_id: 'prod-d52', line_id: 'line-smt1', planned_qty: 500, status: 'open' },
    { wo: 'WO-2026-002', product_id: 'prod-dh7', line_id: 'line-smt1', planned_qty: 300, status: 'open' },
    { wo: 'WO-2026-003', product_id: 'prod-d52', line_id: 'line-smt2', planned_qty: 450, status: 'in_progress' },
    { wo: 'WO-2026-004', product_id: 'prod-x1',  line_id: 'line-sub-ccu', planned_qty: 200, status: 'draft' },
    { wo: 'WO-2026-005', product_id: 'prod-x2',  line_id: 'line-final-ccu1', planned_qty: 150, status: 'open' },
    { wo: 'WO-2026-006', product_id: 'prod-d52', line_id: 'line-final-ccu2', planned_qty: 600, status: 'open' },
  ];
  for (const wo of workOrders) {
    await db.run(`INSERT INTO work_orders (id, wo_number, product_id, line_id, planned_qty, status, planned_start, planned_end, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+7 days'), 'admin@oee.com', datetime('now'), datetime('now'))`,
      [crypto.randomUUID(), wo.wo, wo.product_id, wo.line_id, wo.planned_qty, wo.status]);
  }
  console.log('[SQLite Seed] Berhasil insert ' + workOrders.length + ' Work Orders.');

  await db.close();
  console.log('[SQLite Seed] Seeding selesai sukses!');
}

seed().catch(console.error);
