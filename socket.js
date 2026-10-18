const socket = require('socket.io');
const jwt = require('jsonwebtoken');
const { config } = require('./config');
const { getWorksCount, getUserState } = require('./database/db');
const scannerState = require('./state/scannerState');
const { registerUserSocket, unregisterUserSocket } = require('./state/userSockets');

// socket.io v4 默认不再自动放行跨域握手（v2 时代是放开的）。这里保持等价行为：
// 生产环境前后端同源部署不受影响，开发时前端跑在别的端口需要它。
const SOCKET_OPTIONS = { cors: { origin: true } };

const initSocket = (server) => {
  const io = socket(server, SOCKET_OPTIONS);
  if (config.auth) {
    // 原来的 socketio-jwt-auth 只支持 socket.io v2，这里按它的行为重写：
    // 依次从 x-auth-token 头、query.auth_token、handshake.auth.auth_token 里取 token，
    // 校验签名和有效期（HS256），非 administrator 账号一律拒绝连接。
    // 另外回库核对账号当前状态：token 有效期内账号可能已被禁用 / 删除 / 降级。
    io.use(async (client, next) => {
      const handshake = client.handshake;
      const token =
        handshake.headers['x-auth-token'] ||
        (handshake.query && handshake.query.auth_token) ||
        (handshake.auth && handshake.auth.auth_token);

      if (!token) return next(new Error('认证失败: 缺少 token'));

      let payload;
      try {
        payload = jwt.verify(token, config.jwtsecret, { algorithms: ['HS256'] });
      } catch (err) {
        return next(new Error(`认证失败: ${err.message}`));
      }

      let state;
      try {
        state = await getUserState(payload.name);
      } catch (err) {
        console.error(err);
        return next(new Error('认证失败: 服务器错误'));
      }

      if (state === undefined) {
        return next(new Error('认证失败: 该账号已被删除.'));
      }
      if (state.disabled === 1) {
        return next(new Error('认证失败: 该账号已被禁用.'));
      }

      if (state.group !== 'administrator') {
        // 客户端靠消息里是否含 'administrator' 判断要跳登录页，措辞保持原样
        return next(new Error('认证失败: 只有 administrator 账号能登录管理后台.'));
      }

      const user = {
        // 用户组以数据库为准，避免 token 里的旧用户组一直生效
        name: state.name,
        group: state.group
      };
      user.logged_in = true;
      client.request.user = user;
      return next();
    });
  }

  // 扫描子进程的事件由 scannerState 统一发布，这里只负责广播给所有客户端。
  // http / https 两个 io 实例会各注册一次，共享同一个扫描进程状态。
  scannerState.onEvent((event, payload) => {
    io.emit(event, payload);
  });

  io.on('connection', function (socket) {
    // 登记账号 -> socket，账号被禁用 / 删除时由 credentials 路由主动断开
    const connectedUser = socket.request.user;
    if (connectedUser !== undefined) {
      const userName = connectedUser.name;
      registerUserSocket(userName, socket);
      socket.on('disconnect', () => {
        unregisterUserSocket(userName, socket);
      });
    }

    socket.emit('success', {
      message: '成功登录管理后台.',
      user: socket.request.user,
      auth: config.auth
    });

    socket.on('ON_SCANNER_PAGE', () => {
      // 防止用户在扫描过程中刷新页面
      scannerState.requestInitState();
    });

    socket.on('PERFORM_SCAN', () => {
      scannerState.startScan('scan');
    });

    socket.on('PERFORM_UPDATE', () => {
      scannerState.startScan('update');
    });

    socket.on('PERFORM_SUBTITLE_SCAN', () => {
      scannerState.startScan('subtitles');
    });

    socket.on('PERFORM_COVER_REPAIR', () => {
      scannerState.startScan('covers');
    });

    socket.on('KILL_SCAN_PROCESS', () => {
      // 没有扫描在跑时安全忽略：原先这里会对 null 调 send()，直接把服务端打崩
      scannerState.killScan();
    });

    socket.on('error', (err) => {
      console.error(err);
    });

    socket.on('COUNT_UPDATE', () => {
      getWorksCount(0)
    });
  });
}

module.exports = initSocket;
