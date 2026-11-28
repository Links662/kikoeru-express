const { loadWorkerSettings } = require('./workerSettings');

loadWorkerSettings()
  .then(({ performTagScan }) => performTagScan())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
