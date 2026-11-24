const loadWorkerSettings = async () => {
  const { loadRuntimeSettings } = require('../settings');
  await loadRuntimeSettings();
  return require('./scannerModules');
};

module.exports = { loadWorkerSettings };
