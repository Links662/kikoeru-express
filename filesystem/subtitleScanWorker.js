const { performSubtitleScan } = require('./scanner/subtitleScan');
const { runScanWorker } = require('./scanner/operationRunner');

runScanWorker(
  () => performSubtitleScan(),
  { getExitCode: counts => (counts.failed ? 1 : 0) }
);
