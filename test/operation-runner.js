// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const {
  createScanWorkerRunner
} = require('../filesystem/scanner/operationRunner');

const createHarness = () => {
  const calls = [];
  const errors = [];
  const harness = {
    calls,
    errors,
    exitCode: null
  };

  harness.runner = createScanWorkerRunner({
    database: {
      knex: {
        destroy: async () => calls.push('destroy')
      }
    },
    loadSettings: async () => calls.push('load-settings'),
    assertWorker: () => calls.push('assert-worker'),
    exit: code => {
      harness.exitCode = code;
    },
    output: {
      error: error => errors.push(error)
    }
  });

  return harness;
};

describe('scan operation runner', function () {
  it('loads settings, runs the operation, closes the database and exits', async function () {
    const harness = createHarness();

    const code = await harness.runner(
      async () => {
        harness.calls.push('operation');
        return { failed: 0 };
      }
    );

    expect(code).to.equal(0);
    expect(harness.calls).to.deep.equal([
      'assert-worker',
      'load-settings',
      'operation',
      'destroy'
    ]);
  });

  it('allows an operation to provide a non-zero exit code', async function () {
    const harness = createHarness();

    const code = await harness.runner(
      async () => ({ failed: 2 }),
      { getExitCode: counts => (counts.failed ? 1 : 0) }
    );

    expect(code).to.equal(1);
    expect(harness.exitCode).to.equal(1);
  });

  it('reports operation errors, closes the database and exits with one', async function () {
    const harness = createHarness();
    const expectedError = new Error('扫描失败');

    const code = await harness.runner(async () => {
      throw expectedError;
    });

    expect(code).to.equal(1);
    expect(harness.errors).to.deep.equal([expectedError]);
    expect(harness.calls).to.deep.equal([
      'assert-worker',
      'load-settings',
      'destroy'
    ]);
  });

  it('does not touch the database when worker validation fails', async function () {
    const harness = createHarness();
    harness.runner = createScanWorkerRunner({
      database: {
        knex: {
          destroy: async () => {
            throw new Error('不应关闭数据库');
          }
        }
      },
      loadSettings: async () => harness.calls.push('load-settings'),
      assertWorker: () => {
        throw new Error('worker 只能由扫描子系统启动');
      },
      exit: code => {
        harness.exitCode = code;
      },
      output: {
        error: error => harness.errors.push(error)
      }
    });

    const code = await harness.runner(async () => {
      harness.calls.push('operation');
    });

    expect(code).to.equal(1);
    expect(harness.calls).to.deep.equal([]);
    expect(harness.exitCode).to.equal(1);
  });
});
