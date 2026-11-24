if (typeof process.send !== 'function') {
  console.error('This cover scan worker must be launched by the Kikoeru server.');
  process.exit(1);
}

const { loadWorkerSettings } = require('./workerSettings');

loadWorkerSettings()
  .then(({ performScan }) => performScan({ coversOnly: true }))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
