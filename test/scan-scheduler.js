// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const { createScanScheduler } = require('../state/scanScheduler');

const createHarness = (startScanResult = true) => {
  let current = new Date('2026-11-28T00:00:00.000Z');
  let timerId = 0;
  const scheduled = [];
  const scannerCalls = [];
  const triggerUpdates = [];

  const database = {
    getScanAutomations: async () => ([{
      id: 7,
      type: 'subtitles',
      cronExpression: '0 3 * * *',
      enabled: true,
      lastTriggeredAt: null,
      lastTriggerStatus: null
    }]),
    updateScanAutomationTrigger: async (id, update) => {
      triggerUpdates.push({ id, ...update });
      return 1;
    }
  };
  const scanner = {
    startScan: kind => {
      scannerCalls.push(kind);
      return startScanResult;
    }
  };
  const scheduler = createScanScheduler({
    database,
    scanner,
    timezone: 'Asia/Shanghai',
    now: () => new Date(current),
    setTimeout: (callback, delay) => {
      timerId += 1;
      scheduled.push({ id: timerId, callback, delay });
      return timerId;
    },
    clearTimeout: () => {}
  });

  return {
    scheduler,
    scheduled,
    scannerCalls,
    triggerUpdates,
    advanceTo: value => {
      current = new Date(value);
    }
  };
};

describe('scan scheduler', function () {
  it('starts the configured scan operation and schedules its next run', async function () {
    const harness = createHarness(true);
    await harness.scheduler.start();

    expect(harness.scheduled[0].delay).to.equal(19 * 60 * 60 * 1000);
    expect((await harness.scheduler.list())[0].nextRunLabel).to.include('03:00:00');
    harness.advanceTo('2026-11-28T19:00:00.000Z');
    await harness.scheduled[0].callback();

    expect(harness.scannerCalls).to.deep.equal(['subtitles']);
    expect(harness.triggerUpdates[0]).to.include({
      id: 7,
      status: 'started',
      triggeredAt: '2026-11-28T19:00:00.000Z'
    });
    expect(harness.scheduled[1].delay).to.equal(24 * 60 * 60 * 1000);
    harness.scheduler.stop();
  });

  it('records a skipped trigger when another scan is running', async function () {
    const harness = createHarness(false);
    await harness.scheduler.start();
    harness.advanceTo('2026-11-28T19:00:00.000Z');
    await harness.scheduled[0].callback();

    expect(harness.triggerUpdates[0].status).to.equal('skipped_busy');
    harness.scheduler.stop();
  });
});
