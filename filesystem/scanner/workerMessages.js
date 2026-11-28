const defaultReporter = require('./reporter');

const createWorkerMessageHandler = ({
  reporter = defaultReporter,
  exit = process.exit
} = {}) => message => {
  if (message && message.emit === 'SCAN_INIT_STATE') {
    reporter.initState();
  } else if (message && message.exit) {
    reporter.main('终止扫描进程.', { level: 'error', type: 'summary' });
    exit(Number(message.exit) || 1);
  }
};

const installWorkerMessageHandler = ({
  workerProcess = process,
  reporter = defaultReporter,
  exit = workerProcess.exit
} = {}) => {
  if (
    workerProcess.env.KIKOERU_SCAN_WORKER !== '1' ||
    typeof workerProcess.on !== 'function'
  ) {
    return null;
  }

  const handler = createWorkerMessageHandler({ reporter, exit });
  workerProcess.on('message', handler);
  return handler;
};

module.exports = {
  createWorkerMessageHandler,
  installWorkerMessageHandler
};
