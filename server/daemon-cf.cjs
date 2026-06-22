// Daemon: keeps cloudflared alive for OEE tunnel
try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

var { spawn } = require('child_process');
var path = require('path');

var configPath = process.env.CLOUDFLARED_CONFIG || path.join(process.env.USERPROFILE || require('os').homedir(), '.cloudflared', 'oee-chaolong-config.yml');

function start() {
  console.log('[CF Daemon] Starting cloudflared...');
  var child = spawn('cloudflared', ['tunnel', '--config', configPath, 'run'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  console.log('[CF Daemon] PID:', child.pid);
  
  child.on('exit', function(code) {
    console.log('[CF Daemon] Exited with code', code, '- restarting in 10s...');
    setTimeout(start, 10000);
  });
  
  child.on('error', function(err) {
    console.error('[CF Daemon] Error:', err.message);
    setTimeout(start, 5000);
  });
}

start();
console.log('[CF Daemon] Running. Press Ctrl+C to stop.');
// Keep alive
setInterval(function() {}, 60000);
