try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'oee_central.sqlite');

async function seed() {
  console.log('[Seeder] Starting...');
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.exec('PRAGMA foreign_keys = OFF');

  // Wipe existing data
  const tables = ['alerts','downtime_events','oee_snapshots','edge_nodes','api_tokens','wo_stations','work_orders','products','sessions','user_roles','stations','lines','categories','profiles'];
  for (const t of tables) {
    try { await db.exec('DELETE FROM ' + t); } catch (_) {}
  }

  await db.exec('PRAGMA foreign_keys = ON');

  // ── categories ──
  await db.run("INSERT INTO categories (id, name, sort_order, created_at, target_oee) VALUES (?, ?, ?, ?, ?)",
    ['5d95b697-216b-4f66-b498-474183d083f9', 'CCU', 999, '2026-06-22 17:13:14', 0.85]);

  // ── lines ──
  await db.run("INSERT INTO lines (id, category_id, name, target_oee, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ['10e87f40-e312-4c86-b271-d9745490bfad', '5d95b697-216b-4f66-b498-474183d083f9', 'Final Assy', 0.85, 999, '2026-06-22 17:13:39']);

  // ── stations ──
  await db.run("INSERT INTO stations (id, line_id, name, target_oee, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ['63be1991-462f-41f7-8a99-f411dde7b3ca', '10e87f40-e312-4c86-b271-d9745490bfad', 'Label Paste', 0.85, 999, '2026-06-22 17:13:51']);
  await db.run("INSERT INTO stations (id, line_id, name, target_oee, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ['ba25123f-8d1e-4283-b0c9-bc07682d336a', '10e87f40-e312-4c86-b271-d9745490bfad', 'Final Function', 0.85, 999, '2026-06-22 17:14:17']);

  // ── profiles ──
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync('admin123', salt, 100000, 64, 'sha512').toString('hex');
  const pwdHash = salt + ':' + hash;

  const adminId = 'e8e341e7-88d1-4a26-8417-5f68dfaa92a0';
  await db.run("INSERT INTO profiles (id, full_name, password_hash, line_id, created_at, updated_at, username, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [adminId, 'admin@incl.com', pwdHash, null, '2026-06-22 16:55:47', '2026-06-22 16:55:47', 'admin', 'admin@oee.com']);

  // ── user_roles ──
  await db.run("INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    ['119d8d49-df5b-4ae5-b436-b470a7a939a3', adminId, 'admin', '2026-06-22 16:55:47']);

  // ── products ──
  await db.run("INSERT INTO products (id, code, name, model, serial_prefix, cycle_time_sec, ng_target_ratio, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['prod-d52', 'D52-03', 'CCU Module D52-03', 'D52-03', '0008', 45, 0.02, 1, '2026-06-22 16:55:47', '2026-06-22 16:55:47']);
  await db.run("INSERT INTO products (id, code, name, model, serial_prefix, cycle_time_sec, ng_target_ratio, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['prod-dh7', 'DH7-01', 'CCU Module DH7-01', 'DH7-01', '0020', 55, 0.02, 1, '2026-06-22 16:55:47', '2026-06-22 16:55:47']);

  // ── work_orders ──
  const woId = '495dfe28-f069-43d9-85ca-fb27232c6810';
  await db.run("INSERT INTO work_orders (id, wo_number, product_id, line_id, planned_qty, planned_start, planned_end, status, created_by, created_at, updated_at, actual_qty, ng_qty, station_ids, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [woId, 'WO-20260622-001', 'prod-d52', '10e87f40-e312-4c86-b271-d9745490bfad', 100, '2026-06-23T02:30:00.000Z', '2026-06-23T11:30:00.000Z', 'open', adminId, '2026-06-22 17:15:49', '2026-06-22 17:15:49', 0, 0, JSON.stringify(['ba25123f-8d1e-4283-b0c9-bc07682d336a', '63be1991-462f-41f7-8a99-f411dde7b3ca']), adminId]);

  // ── wo_stations ──
  await db.run("INSERT INTO wo_stations (id, work_order_id, station_id, job_card_number, status, actual_qty, ng_qty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['cf8abd5b-a4fc-4681-9d86-3a24346c1336', woId, 'ba25123f-8d1e-4283-b0c9-bc07682d336a', 'WO-20260622-001/1', 'pending', 0, 0, 0, '2026-06-22 17:15:49', '2026-06-22 17:15:49']);
  await db.run("INSERT INTO wo_stations (id, work_order_id, station_id, job_card_number, status, actual_qty, ng_qty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['1a36b93c-4c8c-4360-a7f9-e3278e65178a', woId, '63be1991-462f-41f7-8a99-f411dde7b3ca', 'WO-20260622-001/2', 'pending', 0, 0, 1, '2026-06-22 17:15:49', '2026-06-22 17:15:49']);

  await db.close();
  console.log('[Seeder] Complete.');
}

seed().catch(console.error);
