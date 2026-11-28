const database = require('../database/db');
const scannerState = require('./scannerState');
const { formatDateTime, getDefaultTimezone, getNextRun } = require('../utils/cron');

const MAX_TIMEOUT = 2147483647;

const createScanScheduler = (options = {}) => {
  const db = options.database || database;
  const scanner = options.scanner || scannerState;
  const timezone = options.timezone || getDefaultTimezone();
  const now = options.now || (() => new Date());
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;

  const listeners = [];
  const entries = new Map();
  const timers = new Map();
  let started = false;
  let generation = 0;

  const onEvent = handler => {
    listeners.push(handler);
  };

  const publish = (event, payload) => {
    listeners.forEach(handler => handler(event, payload));
  };

  const clearTimers = () => {
    timers.forEach(timer => clearTimer(timer));
    timers.clear();
    entries.clear();
  };

  const decorate = automation => {
    const result = {
      ...automation,
      nextRunAt: null,
      nextRunLabel: null,
      lastTriggeredLabel: formatDateTime(automation.lastTriggeredAt, timezone),
      scheduleError: null
    };
    if (!automation.enabled) return result;

    try {
      result.nextRunAt = getNextRun(automation.cronExpression, {
        from: now(),
        timezone
      });
      result.nextRunLabel = formatDateTime(result.nextRunAt, timezone);
    } catch (err) {
      result.scheduleError = err.message;
    }
    return result;
  };

  const loadAutomations = async () => (
    (await db.getScanAutomations()).map(decorate)
  );

  const armTimer = (automation, token) => {
    const decorated = decorate(automation);
    if (!decorated.enabled || !decorated.nextRunAt) {
      entries.set(automation.id, decorated);
      return;
    }

    entries.set(automation.id, decorated);
    const delay = Math.max(0, new Date(decorated.nextRunAt).getTime() - now().getTime());
    const timer = setTimer(() => {
      timers.delete(automation.id);
      const current = entries.get(automation.id);
      if (!started || token !== generation || !current) return;

      if (now().getTime() < new Date(current.nextRunAt).getTime()) {
        armTimer(automation, token);
        return;
      }

      return fireAutomation(automation.id, token).catch((err) => {
        console.error(`扫描自动化 ${automation.id} 执行失败:`, err);
      });
    }, Math.min(delay, MAX_TIMEOUT));
    timers.set(automation.id, timer);
  };

  const fireAutomation = async (id, token) => {
    const automation = entries.get(id);
    if (!started || token !== generation || !automation) return;

    const triggeredAt = now().toISOString();
    let status;
    try {
      status = scanner.startScan(automation.type) ? 'started' : 'skipped_busy';
    } catch (err) {
      status = 'error';
      console.error(`扫描自动化 ${id} 启动失败:`, err);
    }

    try {
      await db.updateScanAutomationTrigger(id, { status, triggeredAt });
    } catch (err) {
      console.error(`扫描自动化 ${id} 触发状态写入失败:`, err);
    }

    publish('SCAN_AUTOMATION_UPDATED', {
      automationId: id,
      status,
      triggeredAt
    });

    if (started && token === generation) {
      armTimer(automation, token);
    }
  };

  const reload = async notify => {
    if (!started) return loadAutomations();

    generation += 1;
    const token = generation;
    clearTimers();

    const automations = await db.getScanAutomations();
    if (token !== generation) return loadAutomations();

    for (const automation of automations) {
      if (!automation.enabled) {
        entries.set(automation.id, decorate(automation));
        continue;
      }
      try {
        armTimer(automation, token);
      } catch (err) {
        entries.set(automation.id, {
          ...automation,
          nextRunAt: null,
          scheduleError: err.message
        });
        console.error(`扫描自动化 ${automation.id} 定时配置无效:`, err);
      }
    }

    if (notify) {
      publish('SCAN_AUTOMATIONS_CHANGED');
    }
  };

  const start = async () => {
    if (started) return;
    started = true;
    try {
      await reload(false);
    } catch (err) {
      started = false;
      if (/no such table:\s*t_scan_automation/i.test(err.message)) {
        throw new Error(
          '扫描自动化表尚未建立，请先执行 db-migrations/20261128_add_scan_automations.sql'
        );
      }
      throw err;
    }
  };

  const stop = () => {
    started = false;
    generation += 1;
    clearTimers();
  };

  const refresh = () => reload(true);

  return {
    start,
    stop,
    refresh,
    list: loadAutomations,
    onEvent
  };
};

const scanScheduler = createScanScheduler();
module.exports = scanScheduler;
module.exports.createScanScheduler = createScanScheduler;
