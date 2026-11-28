const assertScanSubsystemProcess = () => {
  if (process.env.KIKOERU_SCAN_WORKER !== '1' || typeof process.send !== 'function') {
    throw new Error('扫描 worker 只能通过扫描子系统启动。');
  }
};

module.exports = { assertScanSubsystemProcess };
