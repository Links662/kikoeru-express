// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const {
  createProgressReporter
} = require('../filesystem/scanner/progressReporter');

const createHarness = () => {
  const events = [];
  const consoleLines = [];
  const output = {
    log: message => consoleLines.push({ level: 'log', message }),
    warn: message => consoleLines.push({ level: 'warn', message }),
    error: message => consoleLines.push({ level: 'error', message })
  };
  const reporter = createProgressReporter({
    send: payload => events.push(payload),
    output
  });

  return {
    events,
    consoleLines,
    reporter
  };
};

describe('scan progress reporter', function () {
  it('tracks active tasks and emits the existing task payload', function () {
    const { events, reporter } = createHarness();

    reporter.startTask('1731224');
    expect(events).to.deep.equal([]);

    reporter.forWork(1731224).progress('从 DLsite 抓取元数据...');

    const taskEvent = events[events.length - 1];
    expect(taskEvent.event).to.equal('SCAN_TASKS');
    expect(taskEvent.payload.tasks).to.have.length(1);
    expect(taskEvent.payload.tasks[0]).to.include({
      workId: 1731224,
      result: null
    });
    expect(taskEvent.payload.tasks[0].logs[0].message)
      .to.equal('[RJ01731224] 从 DLsite 抓取元数据...');
  });

  it('moves a failed task into failed tasks when it finishes', function () {
    const { events, reporter } = createHarness();

    reporter.startTask(1731224);
    reporter.finishTask(1731224, 'failed');

    expect(events.map(item => item.event)).to.deep.equal([
      'SCAN_TASKS',
      'SCAN_FAILED_TASKS'
    ]);
    const failedEvent = events[events.length - 1];
    expect(failedEvent.payload.failedTasks[0]).to.include({
      workId: 1731224,
      result: 'failed'
    });
  });

  it('falls back to the main log when a task is no longer active', function () {
    const { events, reporter } = createHarness();

    reporter.forWork(1731224).progress('处理进度更新');

    const mainLogEvent = events[events.length - 1];
    expect(mainLogEvent.event).to.equal('SCAN_MAIN_LOGS');
    expect(mainLogEvent.payload.mainLogs[0].message)
      .to.equal('[RJ01731224] 处理进度更新');
  });

  it('records a result with an automatically formatted work label', function () {
    const { events, reporter } = createHarness();

    reporter.recordResult(1731224, 'updated', 3);

    const resultEvent = events[events.length - 1];
    expect(resultEvent.event).to.equal('SCAN_RESULTS');
    expect(resultEvent.payload.results[0]).to.include({
      workId: 1731224,
      result: 'updated',
      count: 3
    });
    expect(resultEvent.payload.results[0].log).to.include({
      level: 'success',
      type: 'item',
      workId: 1731224,
      message: '[RJ01731224] 更新成功.'
    });
  });

  it('formats custom result details without duplicating the work label', function () {
    const { events, reporter } = createHarness();

    reporter.recordResult(
      1731224,
      'failed',
      1,
      '扫描中文字幕失败: 模拟错误'
    );

    const resultEvent = events[events.length - 1];
    expect(resultEvent.payload.results[0].log.message)
      .to.equal('[RJ01731224] 扫描中文字幕失败: 模拟错误.');
  });

  it('keeps console-only logs out of the web timeline', function () {
    const { events, reporter } = createHarness();

    reporter.forWork(1731224).console('中文字幕状态已更新.', {
      level: 'success',
      type: 'item'
    });

    expect(events).to.deep.equal([]);
  });

  it('emits the existing finish event and summary console log', function () {
    const { events, consoleLines, reporter } = createHarness();

    reporter.finish({
      message: '扫描完成: 新增 1 个，失败 0 个.',
      level: 'success'
    });

    expect(events[0]).to.deep.equal({
      event: 'SCAN_FINISHED',
      payload: {
        message: '扫描完成: 新增 1 个，失败 0 个.',
        level: 'success'
      }
    });
    expect(consoleLines[0]).to.deep.equal({
      level: 'log',
      message: '✓ 扫描完成: 新增 1 个，失败 0 个.'
    });
  });

  it('emits the complete state requested by a new page', function () {
    const { events, reporter } = createHarness();

    reporter.startTask(1731224);
    reporter.main('处理音声作品', { type: 'phase' });
    reporter.recordResult(1731224, 'updated', 1);
    reporter.initState();

    const initEvent = events[events.length - 1];
    expect(initEvent.event).to.equal('SCAN_INIT_STATE');
    expect(Object.keys(initEvent.payload).sort()).to.deep.equal([
      'failedTasks',
      'mainLogs',
      'results',
      'tasks'
    ]);
    expect(initEvent.payload.tasks).to.have.length(1);
    expect(initEvent.payload.results).to.have.length(1);
  });
});
