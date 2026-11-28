// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const {
  normalizeSource,
  createScanSnapshot,
  reduceScanEvent,
  resetScanSnapshot,
  buildScanSnapshot
} = require('../state/scannerSnapshot');

describe('scanner snapshot', function () {
  it('normalizes manual and automation sources', function () {
    expect(normalizeSource()).to.deep.equal({ type: 'manual' });
    expect(normalizeSource({ type: 'automation', automationId: 7 }))
      .to.deep.equal({ type: 'automation', automationId: 7 });
  });

  it('reduces progress events into a new snapshot', function () {
    const initial = createScanSnapshot();
    const logs = [
      { type: 'progress', message: '准备中' },
      { type: 'phase', message: '处理音声作品' }
    ];
    const withLogs = reduceScanEvent(initial, 'SCAN_MAIN_LOGS', {
      mainLogs: logs
    });
    const withTasks = reduceScanEvent(withLogs, 'SCAN_TASKS', {
      tasks: [{ workId: 1731224 }]
    });

    expect(initial.mainLogs).to.deep.equal([]);
    expect(withTasks.mainLogs).to.equal(logs);
    expect(withTasks.phase).to.equal('处理音声作品');
    expect(withTasks.tasks).to.have.length(1);
  });

  it('restores running progress from the init event', function () {
    const snapshot = reduceScanEvent(createScanSnapshot(), 'SCAN_INIT_STATE', {
      tasks: [],
      failedTasks: [],
      mainLogs: [{ type: 'phase', message: '刷新作品元数据' }],
      results: [{ workId: 1731224, result: 'updated' }]
    });

    expect(snapshot.status).to.equal('running');
    expect(snapshot.phase).to.equal('刷新作品元数据');
    expect(snapshot.results).to.have.length(1);
  });

  it('uses the latest phase from the main logs', function () {
    const snapshot = reduceScanEvent(createScanSnapshot(), 'SCAN_MAIN_LOGS', {
      mainLogs: [
        { type: 'phase', message: '旧阶段' },
        { type: 'progress', message: '处理中' },
        { type: 'phase', message: '新阶段' }
      ]
    });

    expect(snapshot.phase).to.equal('新阶段');
  });

  it('records finish and error timestamps', function () {
    const now = () => '2026-11-28T12:00:00.000Z';
    const finished = reduceScanEvent(
      createScanSnapshot(),
      'SCAN_FINISHED',
      { message: '完成', level: 'warn' },
      now
    );
    const failed = reduceScanEvent(
      finished,
      'SCAN_ERROR',
      {},
      now
    );

    expect(finished).to.include({
      status: 'finished',
      message: '完成',
      messageLevel: 'warn',
      finishedAt: '2026-11-28T12:00:00.000Z'
    });
    expect(failed).to.include({
      status: 'error',
      finishedAt: '2026-11-28T12:00:00.000Z'
    });
  });

  it('resets progress while preserving previous snapshot immutability', function () {
    const current = reduceScanEvent(createScanSnapshot(), 'SCAN_TASKS', {
      tasks: [{ workId: 1731224 }]
    });
    const reset = resetScanSnapshot(
      current,
      'update',
      { type: 'manual' },
      () => '2026-11-28T13:00:00.000Z'
    );

    expect(current.tasks).to.have.length(1);
    expect(reset.tasks).to.deep.equal([]);
    expect(reset).to.include({
      kind: 'update',
      status: 'running',
      startedAt: '2026-11-28T13:00:00.000Z'
    });
  });

  it('builds counters without changing the public snapshot contract', function () {
    const snapshot = {
      ...createScanSnapshot(),
      tasks: [{ workId: 1 }],
      results: [
        { result: 'updated' },
        { result: 'failed' },
        { result: 'skipped' },
        { result: 'blocked' }
      ]
    };

    expect(buildScanSnapshot(snapshot).counters).to.deep.equal({
      completed: 4,
      running: 1,
      failed: 1,
      skipped: 1,
      blocked: 1,
      total: null
    });
  });
});
