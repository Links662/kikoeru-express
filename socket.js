const socket = require('socket.io');
const jwtAuth = require('socketio-jwt-auth'); // 用于 JWT 验证的 socket.io 中间件
const { config } = require('./config');
const {getWorksCount} = require('./database/db');
const scannerState = require('./scannerState');

const initSocket = (server) => {
  const io = socket(server);
  if (config.auth) {
    io.use(jwtAuth.authenticate({
      secret: config.jwtsecret
    }, (payload, done) => {
      const user = {
        name: payload.name,
        group: payload.group
      };

      if (user.group === 'administrator') {
        done(null, user);
      } else {
        done(null, false, '只有 administrator 账号能登录管理后台.');
      }
    }));
  }

  // 扫描子进程的事件由 scannerState 统一发布，这里只负责广播给所有客户端。
  // http / https 两个 io 实例会各注册一次，共享同一个扫描进程状态。
  scannerState.onEvent((event, payload) => {
    io.emit(event, payload);
  });

  // 有新的客户端连接时触发
  io.on('connection', function (socket) {
    // console.log('connection');
    socket.emit('success', {
      message: '成功登录管理后台.',
      user: socket.request.user,
      auth: config.auth
    });

    // socket.on('disconnect', () => {
    //   console.log('disconnect');
    // });
    
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

    socket.on('KILL_SCAN_PROCESS', () => {
      // 没有扫描在跑时安全忽略：原先这里会对 null 调 send()，直接把服务端打崩
      scannerState.killScan();
    });

    // 发生错误时触发
    socket.on('error', (err) => {
      console.error(err);
    });

    socket.on('COUNT_UPDATE', () => {
      getWorksCount(0)
    });
  });
}

module.exports = initSocket;
