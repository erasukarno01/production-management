try { process.loadEnvFile(); } catch (_) { try { require('dotenv').config(); } catch (_2) {} }

var { spawn } = require('child_process');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var children = [];

function run(cmd, args) {
  var child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    shell: true
  });
  child.unref();
  children.push(child);
  return child;
}

setTimeout(function() { run('node', ['server/ssr-server.cjs']); },    0);
setTimeout(function() { run('node', ['server/local-server.cjs']); },    2000);
setTimeout(function() {
  var cfg = process.env.CLOUDFLARED_CONFIG || path.join(process.env.USERPROFILE || require('os').homedir(), '.cloudflared', 'prod-chaolong-config.yml');
  run('cloudflared', ['tunnel', '--config', cfg, 'run']);
}, 4000);

setInterval(function () {}, 60000);
