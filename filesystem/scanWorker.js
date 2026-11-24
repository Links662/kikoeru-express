const { loadWorkerSettings } = require('./workerSettings')

if (process.argv.length > 2) {
  console.error('scanWorker.js accepts no command-line options; cover maintenance is available only from the administrator scanner page.');
  process.exit(1);
}

loadWorkerSettings()
  .then(({ performScan }) => performScan())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
