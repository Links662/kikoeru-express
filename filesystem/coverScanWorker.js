const { performScan } = require('./scanner/libraryScan');
const { runScanWorker } = require('./scanner/operationRunner');

runScanWorker(() => performScan({ coversOnly: true }));
