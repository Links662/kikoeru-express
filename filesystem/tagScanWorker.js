const { loadWorkerSettings } = require('./workerSettings');

if (typeof process.send !== 'function') {
  console.error('This tag scan worker must be launched by the Kikoeru server.');
  process.exit(1);
}

loadWorkerSettings()
  .then(({ performTagScan }) => performTagScan())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
