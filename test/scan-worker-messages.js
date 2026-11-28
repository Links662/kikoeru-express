// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const { EventEmitter } = require('events');
const {
  createWorkerMessageHandler,
  installWorkerMessageHandler
} = require('../filesystem/scanner/workerMessages');

const createReporter = () => {
  const calls = [];
  return {
    calls,
    initState: () => calls.push('init-state'),
    main: (message, options) => calls.push({ message, options })
  };
};

describe('scan worker messages', function () {
  it('responds to init state requests', function () {
    const reporter = createReporter();
    const handler = createWorkerMessageHandler({ reporter, exit: () => {} });

    handler({ emit: 'SCAN_INIT_STATE' });

    expect(reporter.calls).to.deep.equal(['init-state']);
  });

  it('logs and exits when the scanner is terminated', function () {
    const reporter = createReporter();
    const exitCodes = [];
    const handler = createWorkerMessageHandler({
      reporter,
      exit: code => exitCodes.push(code)
    });

    handler({ exit: 1 });

    expect(reporter.calls).to.deep.equal([
      {
        message: '终止扫描进程.',
        options: { level: 'error', type: 'summary' }
      }
    ]);
    expect(exitCodes).to.deep.equal([1]);
  });

  it('only installs inside a scan worker', function () {
    const workerProcess = new EventEmitter();
    workerProcess.env = {};
    const reporter = createReporter();

    expect(installWorkerMessageHandler({
      workerProcess,
      reporter,
      exit: () => {}
    })).to.equal(null);
  });

  it('handles lifecycle messages after installation', function () {
    const workerProcess = new EventEmitter();
    workerProcess.env = { KIKOERU_SCAN_WORKER: '1' };
    const reporter = createReporter();
    const exitCodes = [];

    installWorkerMessageHandler({
      workerProcess,
      reporter,
      exit: code => exitCodes.push(code)
    });
    workerProcess.emit('message', { emit: 'SCAN_INIT_STATE' });
    workerProcess.emit('message', { exit: 1 });

    expect(reporter.calls).to.deep.equal([
      'init-state',
      {
        message: '终止扫描进程.',
        options: { level: 'error', type: 'summary' }
      }
    ]);
    expect(exitCodes).to.deep.equal([1]);
  });
});
