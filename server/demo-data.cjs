try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'oee_central.sqlite');

const STATION_IDS = ['63be1991-462f-41f7-8a99-f411dde7b3ca', 'ba25123f-8d1e-4283-b0c9-bc07682d336a'];
const STATIONS = [
  { id: STATION_IDS[0], name: 'Label Paste', baseOee: 0.86 },
  { id: STATION_IDS[1], name: 'Final Function', baseOee: 0.78 },
];

const WO_STATIONS = [
  { id: '07d15579-f586-41a8-8985-52dde4d91116', stationId: STATION_IDS[0] },
  { id: '9e93a81f-87cb-4c1f-9add-6203c25be0a2', stationId: STATION_IDS[1] },
];

const WORK_ORDER_ID = 'a86b0836-f40a-466b-848e-27636fb69d83';
const LINE_ID = '10e87f40-e312-4c86-b271-d9745490bfad';

const DEFECT_CATEGORIES = ['solder', 'misalignment', 'scratch', 'contamination', 'component', 'assembly', 'other'];
const DOWNTIME_CATEGORIES = ['breakdown', 'changeover', 'material', 'quality', 'idle', 'other'];

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

function genVals(targetOee) {
  const oee = clamp(targetOee + rand(-0.07, 0.06), 0.65, 0.96);
  const qual = clamp(0.96 + rand(-0.04, 0.035), 0.88, 1);
  const ap = clamp(oee / qual, 0.74, 0.99);
  const avail = clamp(0.92 + rand(-0.07, 0.05), 0.82, 0.99);
  const perf = clamp(ap / avail, 0.78, 0.99);
  return { availability: +avail.toFixed(4), performance: +perf.toFixed(4), quality: +qual.toFixed(4), oee: +(avail * perf * qual).toFixed(4) };
}

function generateSnapshots(stationId, targetOee, hoursBack) {
  const snaps = [];
  const now = Date.now();

  for (let h = 0; h < 24; h++) {
    const ts = new Date(now - (hoursBack - h) * 3600_000);
    const v = genVals(targetOee);
    const planCount = randInt(40, 60);
    const totalCount = Math.round(planCount * rand(0.80, 0.98));
    const ngCount = Math.max(0, Math.round(totalCount * (1 - v.quality)));
    const goodCount = totalCount - ngCount;

    snaps.push({
      id: crypto.randomUUID(),
      station_id: stationId,
      job_card_id: null,
      ts: ts.toISOString(),
      availability: v.availability,
      performance: v.performance,
      quality: v.quality,
      oee: v.oee,
      total_count: totalCount,
      good_count: goodCount,
      ng_count: ngCount,
      plan_count: planCount,
      planned_time_sec: 3600,
      run_time_sec: Math.round(3600 * v.availability),
      speedloss_sec: Math.round(3600 * v.availability * (1 - v.performance)),
    });
  }
  return snaps;
}

function generateDefects() {
  const defects = [];
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const sid = STATIONS[randInt(0, 1)].id;
    const cat = DEFECT_CATEGORIES[randInt(0, DEFECT_CATEGORIES.length - 1)];
    const qty = randInt(1, 6);
    const ts = new Date(now - rand(0, 24) * 3600_000).toISOString();
    defects.push({
      id: 'demo-def-' + crypto.randomUUID().slice(0, 8),
      station_id: sid,
      work_order_id: WORK_ORDER_ID,
      category: cat,
      quantity: qty,
      ts,
    });
  }
  return defects;
}

function generateDowntimes() {
  const downtimes = [];
  const now = Date.now();
  const categories = [...DOWNTIME_CATEGORIES];
  for (let i = 0; i < 6; i++) {
    const sid = i < 3 ? STATIONS[0].id : STATIONS[1].id;
    const cat = categories[i % categories.length];
    const durationSec = randInt(300, 3600);
    const startedAt = new Date(now - rand(0, 23) * 3600_000);
    const endedAt = new Date(startedAt.getTime() + durationSec * 1000);
    downtimes.push({
      id: crypto.randomUUID(),
      station_id: sid,
      job_card_id: null,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_sec: durationSec,
      category: cat,
      reason: `Demo ${cat} event`,
      note: `Generated downtime for ${cat}`,
    });
  }
  return downtimes;
}

function generateAlerts() {
  return [
    {
      id: crypto.randomUUID(),
      station_id: STATIONS[1].id,
      level: 'critical',
      message: `OEE drop below 70% on ${STATIONS[1].name}`,
      oee_value: 0.65,
      acknowledged_at: null,
      acknowledged_by: null,
    },
    {
      id: crypto.randomUUID(),
      station_id: STATIONS[0].id,
      level: 'warning',
      message: `OEE below target on ${STATIONS[0].name}`,
      oee_value: 0.78,
      acknowledged_at: null,
      acknowledged_by: null,
    },
    {
      id: crypto.randomUUID(),
      station_id: STATIONS[1].id,
      level: 'warning',
      message: `NG rate spike on ${STATIONS[1].name}`,
      oee_value: null,
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: 'admin',
    },
    {
      id: crypto.randomUUID(),
      station_id: STATIONS[0].id,
      level: 'critical',
      message: `Unexpected downtime on ${STATIONS[0].name}`,
      oee_value: 0.72,
      acknowledged_at: new Date(Date.now() - 3600_000).toISOString(),
      acknowledged_by: 'admin',
    },
  ];
}

async function main() {
  console.log('[DemoData] Generating demo data...');
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  const existingDefects = await db.get('SELECT COUNT(*) as cnt FROM ng_defects');
  console.log(`[DemoData] Existing ng_defects: ${existingDefects.cnt}`);

  const snapsLabelPaste = generateSnapshots(STATIONS[0].id, STATIONS[0].baseOee, 24);
  const snapsFinalFn = generateSnapshots(STATIONS[1].id, STATIONS[1].baseOee, 24);
  const allSnaps = [...snapsLabelPaste, ...snapsFinalFn];

  console.log(`[DemoData] Inserting ${allSnaps.length} OEE snapshots...`);
  const stmt = await db.prepare(`
    INSERT INTO oee_snapshots (id, station_id, job_card_id, ts, availability, performance, quality, oee, total_count, good_count, ng_count, plan_count, planned_time_sec, run_time_sec, speedloss_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of allSnaps) {
    await stmt.run(s.id, s.station_id, s.job_card_id, s.ts, s.availability, s.performance, s.quality, s.oee, s.total_count, s.good_count, s.ng_count, s.plan_count, s.planned_time_sec, s.run_time_sec, s.speedloss_sec);
  }
  await stmt.finalize();

  const actualMap = {
    [WO_STATIONS[0].id]: { actual: randInt(65, 90), ng: randInt(3, 8) },
    [WO_STATIONS[1].id]: { actual: randInt(55, 80), ng: randInt(2, 7) },
  };
  console.log(`[DemoData] Updating wo_stations actual/ng...`);
  for (const ws of WO_STATIONS) {
    const d = actualMap[ws.id];
    await db.run('UPDATE wo_stations SET actual_qty = ?, ng_qty = ?, status = ? WHERE id = ?', d.actual, d.ng, 'in_progress', ws.id);
  }

  const totalActual = Object.values(actualMap).reduce((s, d) => s + d.actual, 0);
  const totalNg = Object.values(actualMap).reduce((s, d) => s + d.ng, 0);
  console.log(`[DemoData] Updating work_order actual/ng (actual=${totalActual}, ng=${totalNg})...`);
  await db.run('UPDATE work_orders SET actual_qty = ?, ng_qty = ? WHERE id = ?', totalActual, totalNg, WORK_ORDER_ID);

  const defects = generateDefects();
  console.log(`[DemoData] Inserting ${defects.length} ng_defects...`);
  const defStmt = await db.prepare('INSERT INTO ng_defects (id, station_id, work_order_id, category, quantity, ts) VALUES (?, ?, ?, ?, ?, ?)');
  for (const d of defects) {
    await defStmt.run(d.id, d.station_id, d.work_order_id, d.category, d.quantity, d.ts);
  }
  await defStmt.finalize();

  const downtimes = generateDowntimes();
  console.log(`[DemoData] Inserting ${downtimes.length} downtime_events...`);
  const dtStmt = await db.prepare('INSERT INTO downtime_events (id, station_id, job_card_id, started_at, ended_at, duration_sec, category, reason, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const d of downtimes) {
    await dtStmt.run(d.id, d.station_id, d.job_card_id, d.started_at, d.ended_at, d.duration_sec, d.category, d.reason, d.note);
  }
  await dtStmt.finalize();

  const alerts = generateAlerts();
  console.log(`[DemoData] Inserting ${alerts.length} alerts...`);
  const alStmt = await db.prepare('INSERT INTO alerts (id, station_id, level, message, oee_value, acknowledged_at, acknowledged_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const a of alerts) {
    await alStmt.run(a.id, a.station_id, a.level, a.message, a.oee_value, a.acknowledged_at, a.acknowledged_by);
  }
  await alStmt.finalize();

  await db.close();
  console.log('[DemoData] Complete! Restart server with run.bat to see changes.');
}

main().catch(err => { console.error('[DemoData] Error:', err); process.exit(1); });
