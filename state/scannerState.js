const child_process = require('child_process');
const { SCANNER_ENTRY } = require('./scanDefinitions');
const {
  createScanSnapshot,
  reduceScanEvent,
  resetScanSnapshot,
  buildScanSnapshot,
  normalizeSource
} = require('./scannerSnapshot');

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

let scanner = null;
let snapshot = createScanSnapshot();

const listeners = [];

// socket.js 注册：把子进程事件转发给客户端
const onEvent = (handler) => {
  listeners.push(handler);
};

const applyEvent = (event, payload) => {
  snapshot = reduceScanEvent(snapshot, event, payload);
};

const publish = (event, payload) => {
  applyEvent(event, payload);
  listeners.forEach((handler) => {
    handler(event, payload);
  });
};

/**
 * 启动扫描 / 刷新 / 封面维护子进程；已有进程在跑时忽略
 * @param {'scan'|'update'|'tags'|'subtitles'|'covers'} kind
 * @returns {boolean} 是否真的启动了新进程
 */
const startScan = (kind, source = { type: 'manual' }) => {
  if (!Object.prototype.hasOwnProperty.call(SCANNER_ENTRY, kind)) {
    throw new Error(`未知扫描类型: ${kind}`);
  }
  if (scanner) return false;

  snapshot = resetScanSnapshot(
    snapshot,
    kind,
    normalizeSource(source)
  );

  const entry = SCANNER_ENTRY[kind];
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

const getSnapshot = () => buildScanSnapshot(snapshot);

module.exports = {
  onEvent,
  startScan,
  killScan,
  requestInitState,
  getSnapshot
};
