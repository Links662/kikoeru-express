const db = require('../../database/db');
const { loadRuntimeSettings } = require('../../settings');
const { assertScanSubsystemProcess } = require('../scanWorkerGuard');

const createScanWorkerRunner = ({
  database = db,
  loadSettings = loadRuntimeSettings,
  assertWorker = assertScanSubsystemProcess,
  exit = process.exit,
  output = console
} = {}) => async (
  operation,
  { getExitCode = () => 0 } = {}
) => {
  let exitCode = 0;
  let databaseMayBeOpen = false;

  try {
    assertWorker();
    databaseMayBeOpen = true;
    await loadSettings();
    const result = await operation();
    exitCode = Number(getExitCode(result)) || 0;
  } catch (err) {
    output.error(err);
    exitCode = 1;
  } finally {
    if (databaseMayBeOpen) {
      try {
        await database.knex.destroy();
      } catch (err) {
        output.error(err);
        exitCode = 1;
      }
    }
  }

  exit(exitCode);
  return exitCode;
};

const runScanWorker = createScanWorkerRunner();

module.exports = {
  createScanWorkerRunner,
  runScanWorker
};
