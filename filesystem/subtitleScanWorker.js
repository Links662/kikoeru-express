if (typeof process.send !== 'function') {
  console.error('This subtitle scan worker must be launched by the Kikoeru server.');
  process.exit(1);
}

const { loadWorkerSettings } = require('./workerSettings');

loadWorkerSettings()
  .then(({ performSubtitleScan }) => performSubtitleScan())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
