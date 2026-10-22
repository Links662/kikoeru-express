const socket = require('socket.io');
const jwt = require('jsonwebtoken');
const { config } = require('./config');
const { getUserState } = require('./database/db');
const scannerState = require('./state/scannerState');
const { registerUserSocket, unregisterUserSocket } = require('./state/userSockets');

const ADMIN_ROOM = 'administrator';

// socket.io v4 默认不再自动放行跨域握手。生产环境前后端同源部署不受影响，
// 开发时前端跑在别的端口需要它。
const SOCKET_OPTIONS = { cors: { origin: true } };

const initSocket = (server) => {
  const io = socket(server, SOCKET_OPTIONS);

  if (config.auth) {
    // 先从请求头、查询参数或 handshake auth 中取出 JWT，再回库确认账号当前状态。
    // 普通用户也需要连接 socket 接收个人实时事件，扫描类事件在下方单独鉴权。
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
        return next(new Error('认证失败: 该账号已被删除'));
      }
      if (state.disabled === 1) {
        return next(new Error('认证失败: 该账号已被禁用'));
      }

      client.request.user = {
        // 用户组始终以数据库为准，避免 token 中的旧用户组一直生效
        name: state.name,
        group: state.group,
        logged_in: true
      };
      return next();
    });
  }

  // 扫描进度只广播给管理员房间，普通用户不会收到管理后台的数据。
  scannerState.onEvent((event, payload) => {
    io.to(ADMIN_ROOM).emit(event, payload);
  });

  io.on('connection', function (socket) {
    const connectedUser = socket.request.user;
    const userName = connectedUser !== undefined
      ? connectedUser.name
      : (config.auth ? null : 'admin');
    const isAdministrator = !config.auth ||
      (connectedUser !== undefined && connectedUser.group === 'administrator');

    // 账号被禁用 / 删除时，credentials 路由通过这张表主动断开连接。
    if (userName !== null) {
      registerUserSocket(userName, socket);
      socket.on('disconnect', () => {
        unregisterUserSocket(userName, socket);
      });
    }

    if (isAdministrator) {
      socket.join(ADMIN_ROOM);
    }

    socket.emit('success', {
      message: isAdministrator ? '成功登录管理后台.' : '实时连接已建立.',
      user: socket.request.user,
      auth: config.auth
    });

    // 底层连接对普通用户开放，但扫描控制仍只允许管理员使用。
    const onAdministratorEvent = (event, handler) => {
      socket.on(event, (...args) => {
        if (!isAdministrator) return;
        handler(...args);
      });
    };

    onAdministratorEvent('ON_SCANNER_PAGE', () => {
      // 防止用户在扫描过程中刷新页面
      scannerState.requestInitState();
    });

    onAdministratorEvent('PERFORM_SCAN', () => {
      scannerState.startScan('scan');
    });

    onAdministratorEvent('PERFORM_UPDATE', () => {
      scannerState.startScan('update');
    });

    onAdministratorEvent('PERFORM_SUBTITLE_SCAN', () => {
      scannerState.startScan('subtitles');
    });

    onAdministratorEvent('PERFORM_COVER_REPAIR', () => {
      scannerState.startScan('covers');
    });

    onAdministratorEvent('KILL_SCAN_PROCESS', () => {
      // 没有扫描在跑时安全忽略：原先这里会对 null 调 send()，直接把服务端打崩
      scannerState.killScan();
    });

    socket.on('error', (err) => {
      console.error(err);
    });
  });
}

module.exports = initSocket;
