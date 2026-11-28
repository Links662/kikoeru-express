const { formatRJLabel } = require('../../utils/workId');
const { createLog, formatConsoleLog } = require('../scannerLog');

const RESULT_LOG_META = Object.freeze({
  added: { level: 'success', message: '添加成功' },
  repaired: { level: 'success', message: '封面修复成功' },
  upgraded: { level: 'success', message: '封面升级成功' },
  updated: { level: 'success', message: '更新成功' },
  delisted: { level: 'warn', message: '作品已下架，跳过后续刷新' },
  blocked: { level: 'warn', message: 'DLsite 请求受限，刷新已暂停' },
  failed: { level: 'error', message: '处理失败' }
});

const defaultSend = typeof process.send === 'function'
  ? payload => process.send(payload)
  : () => {};

const writeConsoleLog = (output, log) => {
  const method = log.level === 'error'
    ? 'error'
    : log.level === 'warn'
      ? 'warn'
      : 'log';
  output[method](formatConsoleLog(log));
};

const createProgressReporter = ({
  send = defaultSend,
  output = console
} = {}) => {
  const tasks = [];
  const failedTasks = [];
  const mainLogs = [];
  const results = [];

  const emit = (event, payload) => send({ event, payload });

  const getTask = workId => (
    tasks.find(task => task.workId === Number(workId))
  );

  const emitTasks = () => {
    emit('SCAN_TASKS', { tasks });
  };

  const emitFailedTasks = () => {
    emit('SCAN_FAILED_TASKS', { failedTasks });
  };

  const createAndWriteLog = (message, options = {}) => {
    const log = createLog(message, options);
    writeConsoleLog(output, log);
    return log;
  };

  const main = (message, options = {}) => {
    const log = createAndWriteLog(message, options);
    mainLogs.push(log);
    emit('SCAN_MAIN_LOGS', { mainLogs });
    return log;
  };

  const startTask = (workId) => {
    const task = {
      workId: Number(workId),
      result: null,
      logs: []
    };
    tasks.push(task);
    return task;
  };

  const removeTask = (workId) => {
    const index = tasks.findIndex(task => task.workId === Number(workId));
    if (index === -1) return null;

    const task = tasks.splice(index, 1)[0];
    emitTasks();

    if (task.result === 'failed') {
      failedTasks.push(task);
      emitFailedTasks();
    }
    return task;
  };

  const finishTask = (workId, result) => {
    const task = getTask(workId);
    if (task) task.result = result;
    return removeTask(workId);
  };

  const task = (message, workId, options = {}) => {
    const log = createAndWriteLog(message, {
      ...options,
      workId
    });
    const activeTask = getTask(workId);

    if (!activeTask) {
      mainLogs.push(log);
      emit('SCAN_MAIN_LOGS', { mainLogs });
      return log;
    }

    activeTask.logs.push(log);
    emitTasks();
    return log;
  };

  const consoleOnly = (message, options = {}) => (
    createAndWriteLog(message, options)
  );

  const recordResult = (workId, result, count, detail = null) => {
    const meta = RESULT_LOG_META[result] || RESULT_LOG_META.failed;
    const message = detail || meta.message;
    const log = createAndWriteLog(`[${formatRJLabel(workId)}] ${message}.`, {
      level: meta.level,
      type: 'item',
      workId
    });

    results.push({
      workId: Number(workId),
      result,
      count,
      log
    });
    emit('SCAN_RESULTS', { results });
    return log;
  };

  const forWork = (workId) => {
    const label = formatRJLabel(workId);
    const withLabel = message => `[${label}] ${message}`;

    const taskWith = (message, options = {}) => (
      task(withLabel(message), workId, options)
    );

    return {
      progress: (message, options = {}) => taskWith(message, {
        type: 'progress',
        ...options
      }),
      item: (message, options = {}) => taskWith(message, {
        type: 'item',
        ...options
      }),
      detail: (message, options = {}) => taskWith(message, {
        type: 'detail',
        ...options
      }),
      success: (message, options = {}) => taskWith(message, {
        level: 'success',
        type: 'item',
        ...options
      }),
      warn: (message, options = {}) => taskWith(message, {
        level: 'warn',
        type: 'item',
        ...options
      }),
      error: (message, options = {}) => taskWith(message, {
        level: 'error',
        type: 'item',
        ...options
      }),
      main: (message, options = {}) => (
        main(withLabel(message), {
          ...options,
          workId
        })
      ),
      console: (message, options = {}) => (
        consoleOnly(withLabel(message), {
          ...options,
          workId
        })
      )
    };
  };

  const initState = () => {
    emit('SCAN_INIT_STATE', {
      tasks,
      failedTasks,
      mainLogs,
      results
    });
  };

  const finish = ({ message, level = 'info' }) => {
    const log = createAndWriteLog(message, {
      level,
      type: 'summary'
    });
    emit('SCAN_FINISHED', { message, level });
    return log;
  };

  return {
    main,
    forWork,
    startTask,
    finishTask,
    recordResult,
    initState,
    finish
  };
};

module.exports = { createProgressReporter };
