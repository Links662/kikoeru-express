const path = require('path');
const child_process = require('child_process');

/**
 * 扫描进程的唯一状态源。
 *
 * 原先 scanner 子进程和扫描进度只存在于 socket.js 的闭包中：
 *  - socket 一旦断开，前端就再也拿不到扫描进度（只能刷新页面碰运气）
 *  - http / https 两个 io 实例各自 fork 一个子进程，状态互不可见
 *
 * 现在把「子进程 + 进度快照」收敛到这里：
 *  - socket.js 订阅 onEvent，把进度实时广播给所有在线客户端（主通道）
 *  - routes/scanner.js 暴露 getSnapshot()，供前端在 socket 不可用时轮询（兜底）
 */

const SCANNER_ENTRY = {
  scan: path.join(__dirname, '../filesystem/scanWorker.js'),
  update: path.join(__dirname, '../filesystem/updateWorker.js'),
  tags: path.join(__dirname, '../filesystem/tagScanWorker.js'),
  subtitles: path.join(__dirname, '../filesystem/subtitleScanWorker.js'),
  covers: path.join(__dirname, '../filesystem/coverScanWorker.js')
};
const SCAN_KINDS = Object.freeze(Object.keys(SCANNER_ENTRY));

let scanner = null;

// 与 socket 广播内容保持一致的进度快照
const snapshot = {
  kind: null,
  source: null,
  startedAt: null,
  finishedAt: null,
  phase: null,
  status: null, // null(本次进程内还没扫过) | 'running' | 'finished' | 'error'
  tasks: [],
  failedTasks: [],
  mainLogs: [],
  results: [],
  message: null,
  messageLevel: null
};

const listeners = [];

// socket.js 注册：把子进程事件转发给客户端
const onEvent = (handler) => {
  listeners.push(handler);
};

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

const applyEvent = (event, payload) => {
  switch (event) {
    case 'SCAN_TASKS':
      snapshot.tasks = payload.tasks;
      break;
    case 'SCAN_FAILED_TASKS':
      snapshot.failedTasks = payload.failedTasks;
      break;
    case 'SCAN_MAIN_LOGS':
      snapshot.mainLogs = payload.mainLogs;
      snapshot.phase = getLatestPhase(payload.mainLogs);
      break;
    case 'SCAN_RESULTS':
      snapshot.results = payload.results;
      break;
    case 'SCAN_INIT_STATE':
      // 子进程重发当前进度（刷新页面 / 新客户端加入时）
      snapshot.status = 'running';
      snapshot.tasks = payload.tasks;
      snapshot.failedTasks = payload.failedTasks;
      snapshot.mainLogs = payload.mainLogs;
      snapshot.results = payload.results;
      snapshot.phase = getLatestPhase(payload.mainLogs);
      break;
    case 'SCAN_FINISHED':
      snapshot.message = payload.message;
      snapshot.messageLevel = payload.level || 'info';
      snapshot.status = 'finished';
      snapshot.finishedAt = new Date().toISOString();
      break;
    case 'SCAN_ERROR':
      snapshot.status = 'error';
      snapshot.finishedAt = new Date().toISOString();
      break;
    default:
      break;
  }
};

const publish = (event, payload) => {
  applyEvent(event, payload);
  listeners.forEach((handler) => {
    handler(event, payload);
  });
};

const resetSnapshot = (kind, source) => {
  snapshot.status = 'running';
  snapshot.kind = kind;
  snapshot.source = source;
  snapshot.startedAt = new Date().toISOString();
  snapshot.finishedAt = null;
  snapshot.phase = null;
  snapshot.tasks = [];
  snapshot.failedTasks = [];
  snapshot.mainLogs = [];
  snapshot.results = [];
  snapshot.message = null;
  snapshot.messageLevel = null;
};

/**
 * 启动扫描 / 刷新 / 封面维护子进程；已有进程在跑时忽略
 * @param {'scan'|'update'|'tags'|'subtitles'|'covers'} kind
 * @returns {boolean} 是否真的启动了新进程
 */
const startScan = (kind = 'scan', source = { type: 'manual' }) => {
  if (scanner) return false;

  const normalizedKind = Object.prototype.hasOwnProperty.call(SCANNER_ENTRY, kind)
    ? kind
    : 'scan';
  resetSnapshot(normalizedKind, normalizeSource(source));

  const entry = SCANNER_ENTRY[normalizedKind];
  scanner = child_process.fork(entry, [], {
    silent: false,
    env: {
      ...process.env,
      KIKOERU_SCAN_WORKER: '1'
    }
  });

  scanner.on('exit', (code) => {
    scanner = null;
    if (code && snapshot.status !== 'finished' && snapshot.status !== 'error') {
      publish('SCAN_ERROR');
    }
  });

  scanner.on('error', (err) => {
    // fork 失败 / 子进程已经不在等情况：复位状态，避免永远停在 running
    console.error(err);
    scanner = null;
    publish('SCAN_ERROR');
  });

  scanner.on('message', (m) => {
    if (m.event) {
      publish(m.event, m.payload);
    }
  });

  publish('SCAN_STARTED', getSnapshot());

  return true;
};

/**
 * 终止当前扫描进程；没有进程在跑时安全返回
 * @returns {boolean} 是否真的发了终止信号
 */
const killScan = () => {
  if (!scanner) return false;

  scanner.send({ exit: 1 });
  return true;
};

/**
 * 请求子进程把当前进度重发一次
 * @returns {boolean}
 */
const requestInitState = () => {
  if (!scanner) return false;

  scanner.send({ emit: 'SCAN_INIT_STATE' });
  return true;
};

const getSnapshot = () => {
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
  SCAN_KINDS,
  onEvent,
  startScan,
  killScan,
  requestInitState,
  getSnapshot
};
