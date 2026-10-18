if (typeof process.send !== 'function') {
  console.error('This subtitle scan worker must be launched by the Kikoeru server.');
  process.exit(1);
}

const { performSubtitleScan } = require('./scannerModules');

performSubtitleScan()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
