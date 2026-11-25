const LOG_DEPTH = Object.freeze({
  phase: 0,
  summary: 0,
  progress: 1,
  item: 2,
  detail: 3
});

const LOG_LEVELS = new Set(['info', 'success', 'warn', 'error']);
const CONSOLE_MARKERS = Object.freeze({
  phase: '▸',
  summary: '◆',
  progress: '•',
  item: '•',
  detail: '·'
});

let logSequence = 0;

const createLog = (message, {
  level = 'info',
  type = 'progress',
  workId = null
} = {}) => {
  const normalizedLevel = LOG_LEVELS.has(level) ? level : 'info';
  const normalizedType = Object.prototype.hasOwnProperty.call(LOG_DEPTH, type)
    ? type
    : 'progress';
  const parsedWorkId = workId == null ? null : Number(workId);
  const normalizedWorkId = Number.isFinite(parsedWorkId) ? parsedWorkId : null;

  return {
    id: ++logSequence,
    timestamp: Date.now(),
    level: normalizedLevel,
    type: normalizedType,
    depth: LOG_DEPTH[normalizedType],
    ...(normalizedWorkId == null ? {} : { workId: normalizedWorkId }),
    message: String(message).trimEnd()
  };
};

const formatConsoleLog = (log) => {
  const levelMarker = {
    success: '✓',
    warn: '!',
    error: '✕'
  }[log.level];
  const marker = levelMarker || CONSOLE_MARKERS[log.type] || CONSOLE_MARKERS.progress;
  return `${'  '.repeat(log.depth)}${marker} ${log.message}`;
};

module.exports = {
  LOG_DEPTH,
  createLog,
  formatConsoleLog
};
