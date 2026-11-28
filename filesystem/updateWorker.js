const { performUpdate } = require('./scanner/metadataRefresh');
const { runScanWorker } = require('./scanner/operationRunner');

runScanWorker(() => performUpdate({ refreshAll: true }));
