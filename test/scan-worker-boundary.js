// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const path = require('path');
const { spawnSync } = require('child_process');

const WORKERS = [
  'scanWorker.js',
  'updateWorker.js',
  'tagScanWorker.js',
  'subtitleScanWorker.js',
  'coverScanWorker.js'
];

describe('scan worker boundary', function () {
  for (const worker of WORKERS) {
    it(`rejects direct execution of ${worker}`, function () {
      const result = spawnSync(
        process.execPath,
        [path.join(__dirname, '../filesystem', worker)],
        { encoding: 'utf8', timeout: 10000 }
      );
      const output = `${result.stdout || ''}${result.stderr || ''}`;

      expect(result.status).to.not.equal(0);
      expect(output).to.include('扫描 worker 只能通过扫描子系统启动');
    });
  }

  it('rejects direct invocation of every scan operation', async function () {
    const marker = process.env.KIKOERU_SCAN_WORKER;
    delete process.env.KIKOERU_SCAN_WORKER;

    try {
      const {
        performScan,
        performUpdate,
        performTagScan,
        performSubtitleScan
      } = require('../filesystem/scannerModules');
      const operations = [
        performScan,
        performUpdate,
        performTagScan,
        performSubtitleScan
      ];

      for (const operation of operations) {
        let error;
        try {
          await operation();
        } catch (err) {
          error = err;
        }

        expect(error).to.be.an('error');
        expect(error.message).to.include('扫描 worker 只能通过扫描子系统启动');
      }
    } finally {
      if (marker === undefined) {
        delete process.env.KIKOERU_SCAN_WORKER;
      } else {
        process.env.KIKOERU_SCAN_WORKER = marker;
      }
    }
  });
});
