if (typeof process.send !== 'function') {
  console.error('This cover scan worker must be launched by the Kikoeru server.');
  process.exit(1);
}

const { performScan } = require('./scannerModules');

performScan({ coversOnly: true })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
