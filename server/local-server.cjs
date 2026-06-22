// Load .env config — try built-in (Node >=21.7), fallback to dotenv
try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const net = require('net');
const { Aedes } = require('aedes');
const ws = require('websocket-stream');

const PORT = parseInt(process.env.PORT || '5907', 10);
const MQTT_TCP_PORT = parseInt(process.env.MQTT_TCP_PORT || '5908', 10);
const MQTT_WS_PORT = parseInt(process.env.MQTT_WS_PORT || '5909', 10);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'oee_central.sqlite');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// ── MQTT Broker ──
const aedes = new Aedes();

net.createServer(aedes.handle).listen(MQTT_TCP_PORT, '127.0.0.1', () => {
  console.log(`[MQTT] TCP broker on 127.0.0.1:${MQTT_TCP_PORT} (LAN only)`);
});

const mqttWsServer = http.createServer();
ws.createServer({ server: mqttWsServer }, aedes.handle);
mqttWsServer.listen(MQTT_WS_PORT, '0.0.0.0', () => {
  console.log(`[MQTT] WebSocket broker on 0.0.0.0:${MQTT_WS_PORT} (Cloudflare)`);
});

aedes.authenticate = async (client, username, password, callback) => {
  try {
    const token = password ? password.toString() : '';
    const row = await db.get("SELECT * FROM api_tokens WHERE token = ? AND (expires_at IS NULL OR expires_at > datetime('now'))", [token]);
    if (row && row.node_name === username) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  } catch (err) {
    callback(err, false);
  }
};

aedes.authorizePublish = async (client, packet, callback) => {
  callback(null);
};

aedes.authorizeSubscribe = async (client, subscription, callback) => {
  callback(null, subscription);
};

aedes.on('client', (client) => {
  console.log(`[MQTT] Client connected: ${client ? client.id : 'unknown'}`);
});

aedes.on('clientDisconnect', (client) => {
  console.log(`[MQTT] Client disconnected: ${client ? client.id : 'unknown'}`);
});

// ── Auth Middleware ──
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing token' });
  }
  const token = authHeader.split(' ')[1];
  const row = await db.get("SELECT * FROM api_tokens WHERE token = ? AND (expires_at IS NULL OR expires_at > datetime('now'))", [token]);
  if (!row) {
    return res.status(403).json({ error: 'Forbidden: invalid or expired token' });
  }
  await db.run('UPDATE api_tokens SET last_used_at = datetime("now") WHERE id = ?', [row.id]);
  req.edgeNode = row;
  next();
}

// ── User Session Middleware ──
async function requireUserSession(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Unauthorized: missing session token' } });
  }
  const token = authHeader.split(' ')[1];
  const session = await db.get(
    "SELECT s.user_id, p.full_name FROM sessions s JOIN profiles p ON p.id = s.user_id WHERE s.token = ?",
    [token]
  );
  if (!session) {
    return res.status(401).json({ error: { message: 'Session expired or invalid' } });
  }
  req.userId = session.user_id;
  req.userName = session.full_name;
  next();
}

async function requireAdminSession(req, res, next) {
  await requireUserSession(req, res, async () => {
    const roles = await db.all('SELECT role FROM user_roles WHERE user_id = ?', [req.userId]);
    if (!roles.some(function(r) { return r.role === 'admin'; })) {
      return res.status(403).json({ error: { message: 'Forbidden: admin role required' } });
    }
    next();
  });
}

let db;

// Inisialisasi Database SQLite Lokal
async function initDatabase() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  // Enable WAL mode + busy timeout untuk mencegah SQLITE_BUSY
  await db.exec('PRAGMA journal_mode=WAL;');
  await db.exec('PRAGMA busy_timeout=5000;');

  // Buat tabel persis seperti Supabase Migrations
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
      plan_count INTEGER DEFAULT 0,
      planned_time_sec INTEGER DEFAULT 0,
      run_time_sec INTEGER DEFAULT 0,
      speedloss_sec INTEGER DEFAULT 0,
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
      full_name TEXT,
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
      station_id TEXT REFERENCES stations(id) ON DELETE SET NULL,
      permissions TEXT DEFAULT 'read,write',
      expires_at DATETIME,
      last_used_at DATETIME,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Migration for existing databases
  try { await db.exec("ALTER TABLE oee_snapshots ADD COLUMN plan_count INTEGER DEFAULT 0"); } catch (e) {}
  try { await db.exec("CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, label TEXT, node_name TEXT NOT NULL, station_id TEXT, permissions TEXT DEFAULT 'read,write', expires_at DATETIME, last_used_at DATETIME, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"); } catch (e) {}
  try { await db.exec("ALTER TABLE profiles ADD COLUMN password_hash TEXT"); } catch (e) {}
  try { await db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"); } catch (e) {}
  
  console.log('[SQLite Central] Database initialized.');
}

// Parse Supabase join syntax: "*, lines(name, target_oee, categories(name))"
function parseSupabaseSelect(selectStr) {
  const joins = [];
  if (!selectStr || selectStr === '*') return joins;
  
  // Regex to find patterns like: tablename(col1, col2, nested(col1))
  const joinRegex = /(\w+)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  let match;
  while ((match = joinRegex.exec(selectStr)) !== null) {
    const [_, tableName, innerContent] = match;
    // Check if innerContent has nested joins
    const nestedJoins = parseSupabaseSelect(innerContent);
    const columns = innerContent.split(',').map(c => c.trim()).filter(c => !c.includes('('));
    joins.push({ table: tableName, columns, nested: nestedJoins });
  }
  return joins;
}

// Resolve joins for a single row
const JOIN_FK_MAP = {
  'work_orders': { 'products': 'product_id', 'lines': 'line_id', 'stations': 'station_id' },
  'stations':    { 'lines': 'line_id' },
  'lines':       { 'categories': 'category_id' },
};

async function resolveJoins(row, joins, table) {
  const fkCols = JOIN_FK_MAP[table] || {};
  for (const join of joins) {
    const fkCol = fkCols[join.table];
    if (!fkCol) { row[join.table] = null; continue; }
    
    const fkValue = row[fkCol];
    if (!fkValue) { row[join.table] = null; continue; }
    
    if (join.columns.length > 0) {
      const refRow = await db.get(`SELECT ${join.columns.join(',')} FROM ${join.table} WHERE id = ?`, [fkValue]);
      if (refRow) {
        if (join.nested.length > 0) {
          await resolveJoins(refRow, join.nested, join.table);
        }
        row[join.table] = refRow;
      } else {
        row[join.table] = null;
      }
    }
  }
  return row;
}

// REST API for Database Operations (local-db)
app.post('/api/local-db', async (req, res) => {
  const { table, method, queries, data } = req.body;

  try {
    if (method === 'SELECT') {
      // Parse select for joins
      const selectQ = queries.find(q => q.type === 'select');
      const joins = selectQ ? parseSupabaseSelect(selectQ.columns) : [];
      const isHeadOnly = selectQ?.head === true;
      const needCount = selectQ?.count === 'exact';
      
      if (isHeadOnly && needCount) {
        let sql = `SELECT COUNT(*) as total FROM ${table}`;
        const params = [];
        const whereClauses = [];

        queries.forEach(q => {
          if (q.type === 'eq') { whereClauses.push(`${q.column} = ?`); params.push(q.value); }
          else if (q.type === 'is') {
            if (q.value === null) whereClauses.push(`${q.column} IS NULL`);
            else { whereClauses.push(`${q.column} IS ?`); params.push(q.value); }
          }
          else if (q.type === 'like') { whereClauses.push(`${q.column} LIKE ?`); params.push(q.value); }
        });
        if (whereClauses.length > 0) sql += ` WHERE ${whereClauses.join(' AND ')}`;
        const result = await db.get(sql, params);
        return res.json({ data: null, error: null, count: result?.total || 0 });
      }

      let sql = `SELECT * FROM ${table}`;
      const params = [];
      const whereClauses = [];

      queries.forEach(q => {
        if (q.type === 'eq') {
          whereClauses.push(`${q.column} = ?`);
          params.push(q.value);
        } else if (q.type === 'in') {
          const placeholders = q.values.map(() => '?').join(',');
          whereClauses.push(`${q.column} IN (${placeholders})`);
          params.push(...q.values);
        } else if (q.type === 'is') {
          if (q.value === null) {
            whereClauses.push(`${q.column} IS NULL`);
          } else {
            whereClauses.push(`${q.column} IS ?`);
            params.push(q.value);
          }
        } else if (q.type === 'like') {
          whereClauses.push(`${q.column} LIKE ?`);
          params.push(q.value);
        }
      });

      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      const orderQ = queries.find(q => q.type === 'order');
      if (orderQ) {
        sql += ` ORDER BY ${orderQ.column} ${orderQ.ascending ? 'ASC' : 'DESC'}`;
      }

      const limitQ = queries.find(q => q.type === 'limit');
      if (limitQ) {
        sql += ` LIMIT ${limitQ.count}`;
      }

      let rows = await db.all(sql, params);

      // Resolve joins
      if (joins.length > 0 && rows.length > 0) {
        rows = await Promise.all(rows.map(row => resolveJoins(row, joins, table)));
      }

      return res.json({ data: rows, error: null });
    }

    if (method === 'INSERT') {
      const records = Array.isArray(data) ? data : [data];
      const insertedRows = [];

      for (const record of records) {
        if (!record.id) record.id = crypto.randomUUID();

        const columns = Object.keys(record);
        const placeholders = columns.map(() => '?').join(',');
        const values = Object.values(record);

        const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;
        await db.run(sql, values);
        insertedRows.push(record);

        // Realtime broadcast via Socket.io
        io.emit('realtime_change', {
          table: table,
          event: 'INSERT',
          new: record
        });
      }

      return res.json({ data: Array.isArray(data) ? insertedRows : insertedRows[0], error: null });
    }

    if (method === 'UPDATE') {
      const columns = Object.keys(data);
      const setClause = columns.map(col => `${col} = ?`).join(',');
      const values = Object.values(data);

      let sql = `UPDATE ${table} SET ${setClause}`;
      const params = [...values];
      const whereClauses = [];

      queries.forEach(q => {
        if (q.type === 'eq') {
          whereClauses.push(`${q.column} = ?`);
          params.push(q.value);
        }
      });

      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      await db.run(sql, params);

      // Cari record ter-update untuk realtime broadcast
      let selectSql = `SELECT * FROM ${table}`;
      if (whereClauses.length > 0) {
        selectSql += ` WHERE ${whereClauses.join(' AND ')}`;
      }
      const updatedRecord = await db.get(selectSql, params.slice(values.length));

      if (updatedRecord) {
        io.emit('realtime_change', {
          table: table,
          event: 'UPDATE',
          new: updatedRecord
        });
      }

      return res.json({ data: updatedRecord, error: null });
    }

    if (method === 'DELETE') {
      let sql = `DELETE FROM ${table}`;
      const params = [];
      const whereClauses = [];

      queries.forEach(q => {
        if (q.type === 'eq') {
          whereClauses.push(`${q.column} = ?`);
          params.push(q.value);
        }
      });

      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      await db.run(sql, params);
      return res.json({ data: { success: true }, error: null });
    }

  } catch (err) {
    console.error(`[DB Error] ${method} ${table}:`, err.message);
    return res.status(500).json({ data: null, error: { message: err.message } });
  }
});

// REST API for Auth — REAL AUTH with password hashing
app.post('/api/local-auth/signup', async (req, res) => {
  const { email, password, fullName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: { message: 'Email and password required.' } });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: { message: 'Password must be at least 4 characters.' } });
  }

  try {
    const existing = await db.get('SELECT id FROM profiles WHERE id = ? OR full_name = ?', [email, email]);
    if (existing) {
      return res.status(409).json({ error: { message: 'User already registered.' } });
    }

    const userId = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    const passwordHash = salt + ':' + hash;

    await db.run('INSERT INTO profiles (id, full_name, password_hash) VALUES (?, ?, ?)', [userId, fullName || email, passwordHash]);

    const totalUsers = await db.get('SELECT COUNT(*) as count FROM user_roles');
    const role = totalUsers.count === 0 ? 'admin' : 'viewer';
    await db.run('INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)', [crypto.randomUUID(), userId, role]);

    const roles = [role];
    const sessionToken = crypto.randomBytes(32).toString('hex');
    await db.run('INSERT INTO sessions (id, user_id, token, created_at) VALUES (?, ?, ?, datetime(\"now\"))', [crypto.randomUUID(), userId, sessionToken]);

    const user = { id: userId, email, roles };
    return res.status(201).json({ user, session: { access_token: sessionToken } });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
});

app.post('/api/local-auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: { message: 'Email and password required.' } });
  }

  try {
    const profile = await db.get('SELECT * FROM profiles WHERE full_name = ? OR id = ?', [email, email]);

    if (!profile) {
      // Auto-create first user only if DB is completely empty
      const totalUsers = await db.get('SELECT COUNT(*) as count FROM profiles');
      if (totalUsers.count === 0) {
        const userId = crypto.randomUUID();
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, 100000, 64, 'sha512').toString('hex');
        const passwordHash = salt + ':' + hash;

        await db.run('INSERT INTO profiles (id, full_name, password_hash) VALUES (?, ?, ?)', [userId, email, passwordHash]);
        await db.run('INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)', [crypto.randomUUID(), userId, 'admin']);

        const sessionToken = crypto.randomBytes(32).toString('hex');
        await db.run('INSERT INTO sessions (id, user_id, token, created_at) VALUES (?, ?, ?, datetime(\"now\"))', [crypto.randomUUID(), userId, sessionToken]);

        const user = { id: userId, email, roles: ['admin'] };
        return res.json({ user, session: { access_token: sessionToken } });
      }
      return res.status(401).json({ error: { message: 'Invalid email or password.' } });
    }

    // Verify password (or auto-migrate existing users without password_hash)
    if (!profile.password_hash) {
      // Migrate: set password_hash from current password input
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
      const passwordHash = salt + ':' + hash;
      await db.run('UPDATE profiles SET password_hash = ? WHERE id = ?', [passwordHash, profile.id]);
      console.log('[Auth] Migrated existing user to real auth: ' + profile.full_name);
    } else {
      const [salt, storedHash] = profile.password_hash.split(':');
      const computedHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');

      if (computedHash !== storedHash) {
        return res.status(401).json({ error: { message: 'Invalid email or password.' } });
      }
    }

    const rolesRows = await db.all('SELECT role FROM user_roles WHERE user_id = ?', [profile.id]);
    const roles = rolesRows.map(r => r.role);

    // Create session
    const sessionToken = crypto.randomBytes(32).toString('hex');
    await db.run('INSERT INTO sessions (id, user_id, token, created_at) VALUES (?, ?, ?, datetime(\"now\"))', [crypto.randomUUID(), profile.id, sessionToken]);

    const user = { id: profile.id, email: profile.full_name || email, roles };
    return res.json({ user, session: { access_token: sessionToken } });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
});

// Verify session / get current user
app.get('/api/local-auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Not authenticated.' } });
  }
  const token = authHeader.split(' ')[1];
  try {
    const session = await db.get(
      "SELECT s.user_id, p.full_name FROM sessions s JOIN profiles p ON p.id = s.user_id WHERE s.token = ?",
      [token]
    );
    if (!session) return res.status(401).json({ error: { message: 'Session expired or invalid.' } });

    const rolesRows = await db.all('SELECT role FROM user_roles WHERE user_id = ?', [session.user_id]);
    const roles = rolesRows.map(r => r.role);

    return res.json({ user: { id: session.user_id, email: session.full_name, roles } });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
});

// Sign out
app.post('/api/local-auth/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    } catch (err) { /* ignore */ }
  }
  return res.json({ success: true });
});

// REST API endpoint untuk sinkronisasi dari edge
app.post('/api/sync', async (req, res) => {
  const { logs } = req.body;
  if (!logs || !Array.isArray(logs)) {
    return res.status(400).json({ error: 'Format logs tidak valid.' });
  }

  // Edge Sync: terima OEE snapshot dari edge node
  try {
    for (const log of logs) {
      if (log.event_type === 'snapshot') {
        const id = crypto.randomUUID();
        await db.run(`
          INSERT INTO oee_snapshots (id, station_id, job_card_id, availability, performance, quality, oee, total_count, good_count, ng_count, plan_count, planned_time_sec, run_time_sec, speedloss_sec)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          id, log.station_id, log.job_card_id || null, log.availability, log.performance, log.quality, log.oee,
          log.total_count, log.good_count, log.ng_count, log.plan_count || 0, log.planned_time_sec, log.run_time_sec, log.speedloss_sec
        ]);

        io.emit('realtime_change', {
          table: 'oee_snapshots',
          event: 'INSERT',
          new: { id, station_id: log.station_id, availability: log.availability, performance: log.performance, quality: log.quality, oee: log.oee }
        });
      }
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// REST API: ambil hierarki stations (Category -> Line -> Station)
app.get('/api/stations', async (req, res) => {
  try {
    const categories = await db.all('SELECT * FROM categories ORDER BY sort_order');
    const lines = await db.all('SELECT * FROM lines ORDER BY sort_order');
    const stations = await db.all('SELECT * FROM stations ORDER BY sort_order');

    const tree = categories.map(cat => ({
      ...cat,
      lines: lines.filter(l => l.category_id === cat.id).map(line => ({
        ...line,
        stations: stations.filter(s => s.line_id === line.id),
      })),
    }));

    res.json({ data: tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REST API: edge register workstation (token-based auto-config)
app.post('/api/edge/register', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];

  try {
    // Lookup token → get station_id from api_tokens
    const tokenRow = await db.get('SELECT * FROM api_tokens WHERE token = ?', [token]);
    if (!tokenRow) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    const stationId = tokenRow.station_id;
    if (!stationId) {
      return res.status(400).json({ error: 'Token tidak memiliki station_id. Assign station ke token ini terlebih dahulu.' });
    }

    // Get station info
    const station = await db.get('SELECT s.*, l.name as line_name, c.name as group_name FROM stations s LEFT JOIN lines l ON l.id = s.line_id LEFT JOIN categories c ON c.id = l.category_id WHERE s.id = ?', [stationId]);
    if (!station) {
      return res.status(404).json({ error: 'Station ' + stationId + ' tidak ditemukan.' });
    }

    const nodeName = tokenRow.node_name || station.id;
    const now = new Date().toISOString();

    // Upsert edge node
    const existing = await db.get('SELECT id FROM edge_nodes WHERE node_name = ?', [nodeName]);
    if (existing) {
      await db.run('UPDATE edge_nodes SET station_id = ?, station_name = ?, line_name = ?, group_category = ?, status = ?, last_seen = ?, updated_at = ? WHERE id = ?', [station.id, station.name, station.line_name, station.group_name, 'active', now, now, existing.id]);
    } else {
      await db.run('INSERT INTO edge_nodes (id, node_name, station_id, station_name, line_name, group_category, status, last_seen, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), nodeName, station.id, station.name, station.line_name, station.group_name, 'active', now, now, now]);
    }

    await db.run('UPDATE api_tokens SET last_used_at = datetime("now") WHERE id = ?', [tokenRow.id]);

    console.log('[Edge Register] ' + nodeName + ' -> station ' + station.id + ' (' + station.name + ')');

    // Return MQTT info
    const mqttInfo = {
      broker_wss: 'wss://prod.chaolong-india.com/mqtt',
      broker_tcp: '127.0.0.1:' + MQTT_TCP_PORT,
      username: nodeName,
    };

    return res.json({
      success: true,
      station_id: station.id,
      station_name: station.name,
      line_name: station.line_name,
      line_id: station.line_id,
      node_name: nodeName,
      target_oee: station.target_oee,
      group_category: station.group_name,
      mqtt: mqttInfo,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// REST API: daftar edge nodes
app.get('/api/edge/nodes', requireAdminSession, async (req, res) => {
  try {
    const nodes = await db.all('SELECT * FROM edge_nodes ORDER BY updated_at DESC');
    return res.json({ data: nodes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// REST API: update edge node
app.put('/api/edge/nodes/:id', requireAdminSession, async (req, res) => {
  const { id } = req.params;
  const { station_id, node_name } = req.body;
  try {
    await db.run('UPDATE edge_nodes SET station_id = ?, node_name = ?, updated_at = ? WHERE id = ?', [station_id || null, node_name || null, new Date().toISOString(), id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// REST API: hapus edge node
app.delete('/api/edge/nodes/:id', requireAdminSession, async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM edge_nodes WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── API Token Management ──
app.get('/api/admin/tokens', requireAdminSession, async (req, res) => {
  try {
    const tokens = await db.all('SELECT * FROM api_tokens ORDER BY created_at DESC');
    return res.json({ data: tokens });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/tokens', requireAdminSession, async (req, res) => {
  const { node_name, station_id, label } = req.body;
  if (!node_name) return res.status(400).json({ error: 'node_name diperlukan.' });
  try {
    const id = crypto.randomUUID();
    const token = 'oee_' + crypto.randomBytes(24).toString('hex');
    await db.run('INSERT INTO api_tokens (id, token, label, node_name, station_id) VALUES (?, ?, ?, ?, ?)',
      [id, token, label || node_name, node_name, station_id || null]);
    return res.json({ data: { id, token, node_name, station_id } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/tokens/:id', requireAdminSession, async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM api_tokens WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/tokens/:id/regenerate', requireAdminSession, async (req, res) => {
  const { id } = req.params;
  try {
    const token = 'oee_' + crypto.randomBytes(24).toString('hex');
    await db.run('UPDATE api_tokens SET token = ?, updated_at = datetime("now") WHERE id = ?', [token, id]);
    return res.json({ data: { id, token } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('[WebSocket] Client connected.');
});

async function main() {
  await initDatabase();

  // Safe migrations: add production columns to work_orders
  var tableInfo = await db.all("PRAGMA table_info(work_orders)");
  var existingCols = tableInfo.map(function(r) { return r.name; });
  var migrations = {
    actual_qty: 'INTEGER DEFAULT 0',
    ng_qty: 'INTEGER DEFAULT 0',
    per: 'REAL',
    otr: 'REAL',
    qr: 'REAL',
    oee: 'REAL',
    station_ids: 'TEXT',
    updated_by: 'TEXT'
  };
  for (var col in migrations) {
    if (migrations.hasOwnProperty(col) && !existingCols.includes(col)) {
      try { await db.run('ALTER TABLE work_orders ADD COLUMN ' + col + ' ' + migrations[col]); } catch (e) { console.error('Migration failed for ' + col + ':', e.message); }
    }
  }

  // Migration: add job_card_id to oee_snapshots
  var snapInfo = await db.all("PRAGMA table_info(oee_snapshots)");
  var snapCols = snapInfo.map(function(r) { return r.name; });
  if (!snapCols.includes('job_card_id')) {
    try { await db.run('ALTER TABLE oee_snapshots ADD COLUMN job_card_id TEXT'); } catch (e) { console.error('Migration failed for job_card_id:', e.message); }
  }

  // Migration: add serial_prefix to products
  var prodInfo = await db.all("PRAGMA table_info(products)");
  var prodCols = prodInfo.map(function(r) { return r.name; });
  if (!prodCols.includes('serial_prefix')) {
    try {
      await db.run('ALTER TABLE products ADD COLUMN serial_prefix TEXT');
      // Populate known mappings
      await db.run("UPDATE products SET serial_prefix = '0008' WHERE model LIKE 'D52%' AND serial_prefix IS NULL");
      await db.run("UPDATE products SET serial_prefix = '0020' WHERE model LIKE 'DH7%' AND serial_prefix IS NULL");
      console.log('  ✅ Added serial_prefix to products');
    } catch (e) { console.error('Migration failed for serial_prefix:', e.message); }
  }

  // ── Proxy non-API routes to SSR frontend server ──
  const SSR_PORT = parseInt(process.env.SSR_PORT || '3002', 10);
  const httpProxy = require('http');
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    const options = {
      hostname: '127.0.0.1',
      port: SSR_PORT,
      path: req.originalUrl,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:' + SSR_PORT },
    };
    const proxyReq = httpProxy.request(options, (proxyRes) => {
      // Handle WebSocket upgrade for MQTT
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        res.writeHead(101, { ...proxyRes.headers, 'Connection': 'Upgrade', 'Upgrade': 'websocket' });
        return;
      }
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => {
      res.status(502).send('Frontend server not available. Run: npm run dev or npm run build && node dist/server/server.js');
    });
    req.pipe(proxyReq);
  });

  server.listen(PORT, () => {
    console.log(`[Production Management Server] Running locally on port ${PORT}`);
  });
}

main().catch(console.error);
