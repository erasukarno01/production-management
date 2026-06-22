// Start server wrapper with error handling
process.on('uncaughtException', function(e) {
  console.log('FATAL:', e.message);
  process.exit(1);
});
require('./local-server.cjs');
