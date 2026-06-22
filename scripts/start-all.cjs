// ============================================================
//  Chao Long India — INCL OEE System
//  Start ALL services: API + MQTT + Frontend
//  Usage: node start-all.cjs
// ============================================================

try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

var { spawn } = require('child_process');
var path = require('path');

var API_PORT = parseInt(process.env.PORT || '5907', 10);
var WEB_PORT = parseInt(process.env.VITE_DEV_PORT || '5177', 10);

var ROOT = path.join(__dirname, '..');
var children = [];

function run(label, cmd, args, opts) {
  console.log('[' + label + '] Starting...');
  var child = spawn(cmd, args, Object.assign({
    cwd: ROOT,
    stdio: 'inherit',
    shell: true
  }, opts || {}));
  children.push(child);
  child.on('error', function(err) {
    console.error('[' + label + '] Failed:', err.message);
  });
  child.on('exit', function(code) {
    console.log('[' + label + '] Exited with code', code);
  });
  return child;
}

// Cleanup on exit
function cleanup() {
  console.log('\nShutting down all services...');
  children.forEach(function(c) { c.kill(); });
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

console.log('============================================================');
console.log('  Chao Long India — OEE Production System');
console.log('============================================================');
console.log('');

// 1. API Server + MQTT Broker
run('API', 'node', ['server/local-server.cjs']);

// 2. Frontend Dev Server — wait 2s for API to start
setTimeout(function() {
  run('WEB', 'npx', ['vite', '--port', String(WEB_PORT), '--strictPort']);
}, 2000);

console.log('');
console.log('Services starting...');
console.log('  API/MQTT:  http://localhost:' + API_PORT);
console.log('  Frontend:  http://localhost:' + WEB_PORT);
console.log('  Login:     http://localhost:' + WEB_PORT + '/auth');
console.log('  User:      admin@oee.com / admin123');
console.log('');
console.log('Press Ctrl+C to stop all services.');
console.log('');
