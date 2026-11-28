const { loadWorkerSettings } = require('./workerSettings');

loadWorkerSettings()
  .then(({ performUpdate }) => performUpdate({ refreshAll: true }))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
