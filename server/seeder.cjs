try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'oee_central.sqlite');

const ADMIN_ID = 'e8e341e7-88d1-4a26-8417-5f68dfaa92a0';
const SECTION_ID = '5d95b697-216b-4f66-b498-474183d083f9';
const LINE_ID = '10e87f40-e312-4c86-b271-d9745490bfad';
const STATION_IDS = ['63be1991-462f-41f7-8a99-f411dde7b3ca', 'ba25123f-8d1e-4283-b0c9-bc07682d336a'];
const WO_ID = 'a86b0836-f40a-466b-848e-27636fb69d83';

function makePwdHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

async function seed() {
  console.log('[Seeder] Starting...');
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  await db.exec('PRAGMA foreign_keys = OFF');

  const tables = ['ng_defects','alerts','downtime_events','oee_snapshots','edge_nodes','api_tokens','wo_stations','work_orders','products','sessions','user_roles','stations','lines','production_sections','profiles'];
  for (const t of tables) {
    try { await db.exec('DELETE FROM ' + t); } catch (_) {}
  }

  await db.exec('PRAGMA foreign_keys = ON');

  // ── production_sections ──
  await db.run("INSERT INTO production_sections (id, name, sort_order, created_at, target_oee) VALUES (?, ?, ?, ?, ?)",
    [SECTION_ID, 'CCU', 999, '2026-06-22 17:13:14', 0.85]);

  // ── lines ──
  await db.run("INSERT INTO lines (id, production_section_id, name, target_oee, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [LINE_ID, SECTION_ID, 'Final Assy', 0.85, 999, '2026-06-22 17:13:39']);

  // ── stations ──
  await db.run("INSERT INTO stations (id, line_id, name, target_oee, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [STATION_IDS[0], LINE_ID, 'Label Paste', 0.85, 999, '2026-06-22 17:13:51']);
  await db.run("INSERT INTO stations (id, line_id, name, target_oee, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [STATION_IDS[1], LINE_ID, 'Final Function', 0.85, 999, '2026-06-22 17:14:17']);

  // ── profiles ──
  await db.run("INSERT INTO profiles (id, full_name, password_hash, line_id, created_at, updated_at, username, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [ADMIN_ID, 'admin@incl.com', makePwdHash('admin123'), null, '2026-06-22 16:55:47', '2026-06-22 16:55:47', 'admin', 'admin@oee.com']);

  // ── user_roles ──
  await db.run("INSERT INTO user_roles (id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
    ['119d8d49-df5b-4ae5-b436-b470a7a939a3', ADMIN_ID, 'admin', '2026-06-22 16:55:47']);

  // ── products ──
  await db.run("INSERT INTO products (id, code, name, model, serial_prefix, cycle_time_sec, ng_target_ratio, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['prod-d52', 'D52-H5810-03-00-80', 'CCU Module D52-03', 'D52-03', '0008', 45, 0.0005, 1, '2026-06-22 16:55:47', '2026-06-22 16:55:47']);
  await db.run("INSERT INTO products (id, code, name, model, serial_prefix, cycle_time_sec, ng_target_ratio, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['prod-dh7', 'DH7-H5810-00-00-80', 'CCU Module DH7-01', 'DH7-00', '0020', 55, 0.0005, 1, '2026-06-22 16:55:47', '2026-06-22 16:55:47']);

  // ── work_orders ──
  await db.run("INSERT INTO work_orders (id, wo_number, product_id, line_id, planned_qty, planned_start, planned_end, status, created_by, created_at, updated_at, actual_qty, ng_qty, station_ids, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [WO_ID, 'WO-20260623-0001', 'prod-d52', LINE_ID, 100, '2026-06-23T02:30:00.000Z', '2026-06-23T11:30:00.000Z', 'open', ADMIN_ID, '2026-06-23 06:10:51', '2026-06-23 06:10:51', 0, 0, JSON.stringify(STATION_IDS), ADMIN_ID]);

  // ── wo_stations ──
  await db.run("INSERT INTO wo_stations (id, work_order_id, station_id, job_card_number, status, actual_qty, ng_qty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['9e93a81f-87cb-4c1f-9add-6203c25be0a2', WO_ID, STATION_IDS[1], 'WO-20260623-0001/1', 'pending', 0, 0, 0, '2026-06-23 06:10:51', '2026-06-23 06:10:51']);
  await db.run("INSERT INTO wo_stations (id, work_order_id, station_id, job_card_number, status, actual_qty, ng_qty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ['07d15579-f586-41a8-8985-52dde4d91116', WO_ID, STATION_IDS[0], 'WO-20260623-0001/2', 'pending', 0, 0, 1, '2026-06-23 06:10:51', '2026-06-23 06:10:51']);

  // ── api_tokens ──
  await db.run("INSERT INTO api_tokens (id, token, label, node_name, station_id, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ['7648b532-b030-4b28-b2f8-854185574552', 'oee_fff79c4cc3c5a17e8352c62f38c4bb613f0cc137e81b2b2b', 'LABEL_PASTE', 'LABEL_PASTE', STATION_IDS[0], 'read,write', '2026-06-23 06:09:25', '2026-06-23 06:09:25']);
  await db.run("INSERT INTO api_tokens (id, token, label, node_name, station_id, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ['4fdedbf5-dd0a-4d6b-b1aa-7156fda80877', 'oee_88c4a320ef251d013b0c5cc4ca4167863c455e1ee175c0d4', 'FINAL_FUNCTION', 'FINAL_FUNCTION', STATION_IDS[1], 'read,write', '2026-06-23 06:09:25', '2026-06-23 06:09:25']);

  // ── ng_defects ──
  const defectCategories = ['solder', 'misalignment', 'scratch', 'contamination', 'component', 'assembly', 'other'];
  for (let i = 0; i < 20; i++) {
    const cat = defectCategories[Math.floor(Math.random() * defectCategories.length)];
    const sid = STATION_IDS[Math.floor(Math.random() * STATION_IDS.length)];
    const qty = Math.floor(Math.random() * 5) + 1;
    const ts = new Date(Date.now() - Math.random() * 24 * 3600_000).toISOString();
    await db.run("INSERT INTO ng_defects (id, station_id, work_order_id, category, quantity, ts) VALUES (?, ?, ?, ?, ?, ?)",
      ['def-' + i, sid, WO_ID, cat, qty, ts]);
  }

  await db.close();
  console.log('[Seeder] Complete.');
}

seed().catch(console.error);
