const { loadWorkerSettings } = require('./workerSettings');

loadWorkerSettings()
  .then(({ performScan }) => performScan({ coversOnly: true }))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
