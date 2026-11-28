const { loadWorkerSettings } = require('./workerSettings');

loadWorkerSettings()
  .then(({ performSubtitleScan }) => performSubtitleScan())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
