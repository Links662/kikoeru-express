const { loadWorkerSettings } = require('./workerSettings');

loadWorkerSettings()
  .then(({ performScan }) => performScan())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
