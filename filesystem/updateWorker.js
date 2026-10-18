if (typeof process.send !== 'function') {
  console.error('This metadata update worker must be launched by the Kikoeru server.');
  process.exit(1);
}

const { performUpdate } = require('./scannerModules');

performUpdate({ refreshAll: true })
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
