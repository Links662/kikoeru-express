const { performTagScan } = require('./scanner/tagSync');
const { runScanWorker } = require('./scanner/operationRunner');

runScanWorker(() => performTagScan());
