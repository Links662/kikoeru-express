const getLatestPhase = (logs = []) => {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    if (logs[index].type === 'phase') return logs[index].message;
  }
  return null;
};

const normalizeSource = (source) => {
  if (source && source.type === 'automation') {
    return {
      type: 'automation',
      automationId: source.automationId
    };
  }
  return { type: 'manual' };
};

const createScanSnapshot = () => ({
  kind: null,
  source: null,
  startedAt: null,
  finishedAt: null,
  phase: null,
  status: null,
  tasks: [],
  failedTasks: [],
  mainLogs: [],
  results: [],
  message: null,
  messageLevel: null
});

const reduceScanEvent = (
  snapshot,
  event,
  payload = {},
  now = () => new Date().toISOString()
) => {
  switch (event) {
    case 'SCAN_TASKS':
      return {
        ...snapshot,
        tasks: payload.tasks
      };
    case 'SCAN_FAILED_TASKS':
      return {
        ...snapshot,
        failedTasks: payload.failedTasks
      };
    case 'SCAN_MAIN_LOGS':
      return {
        ...snapshot,
        mainLogs: payload.mainLogs,
        phase: getLatestPhase(payload.mainLogs)
      };
    case 'SCAN_RESULTS':
      return {
        ...snapshot,
        results: payload.results
      };
    case 'SCAN_INIT_STATE':
      return {
        ...snapshot,
        status: 'running',
        tasks: payload.tasks,
        failedTasks: payload.failedTasks,
        mainLogs: payload.mainLogs,
        results: payload.results,
        phase: getLatestPhase(payload.mainLogs)
      };
    case 'SCAN_FINISHED':
      return {
        ...snapshot,
        message: payload.message,
        messageLevel: payload.level || 'info',
        status: 'finished',
        finishedAt: now()
      };
    case 'SCAN_ERROR':
      return {
        ...snapshot,
        status: 'error',
        finishedAt: now()
      };
    default:
      return snapshot;
  }
};

const resetScanSnapshot = (
  snapshot,
  kind,
  source,
  now = () => new Date().toISOString()
) => ({
  ...snapshot,
  status: 'running',
  kind,
  source,
  startedAt: now(),
  finishedAt: null,
  phase: null,
  tasks: [],
  failedTasks: [],
  mainLogs: [],
  results: [],
  message: null,
  messageLevel: null
});

const buildScanSnapshot = (snapshot) => {
  const results = snapshot.results;
  return {
    status: snapshot.status,
    kind: snapshot.kind,
    source: snapshot.source,
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    phase: snapshot.phase,
    counters: {
      completed: results.length,
      running: snapshot.tasks.length,
      failed: results.filter(result => result.result === 'failed').length,
      skipped: results.filter(result => result.result === 'skipped').length,
      blocked: results.filter(result => result.result === 'blocked').length,
      total: null
    },
    tasks: snapshot.tasks,
    failedTasks: snapshot.failedTasks,
    mainLogs: snapshot.mainLogs,
    results,
    message: snapshot.message,
    messageLevel: snapshot.messageLevel
  };
};

module.exports = {
  normalizeSource,
  createScanSnapshot,
  reduceScanEvent,
  resetScanSnapshot,
  buildScanSnapshot
};
