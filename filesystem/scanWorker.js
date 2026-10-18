const { performScan } = require('./scannerModules')

if (process.argv.length > 2) {
  console.error('scanWorker.js accepts no command-line options; cover maintenance is available only from the administrator scanner page.');
  process.exit(1);
}

performScan();
