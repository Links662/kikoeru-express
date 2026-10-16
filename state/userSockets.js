/**
 * 记录“哪个账号开着哪些后台 socket”。
 *
 * 账号被禁用 / 被删除时，光靠 JWT 是踢不掉已经连上的客户端的
 * （token 还在有效期内），所以这里保存引用，操作后由调用方主动断开。
 *
 * 进程级状态，只服务于当前进程的 socket 实例（http / https 两个实例共用一个注册表）。
 */

const socketsByUser = new Map();

const registerUserSocket = (userName, socket) => {
  if (typeof userName !== 'string' || userName === '') return;

  if (!socketsByUser.has(userName)) {
    socketsByUser.set(userName, new Set());
  }
  socketsByUser.get(userName).add(socket);
};

const unregisterUserSocket = (userName, socket) => {
  const sockets = socketsByUser.get(userName);
  if (sockets === undefined) return;

  sockets.delete(socket);
  if (sockets.size === 0) {
    socketsByUser.delete(userName);
  }
};

/**
 * 断开指定账号的所有 socket
 * @param {String|String[]} names 用户名或用户名数组
 */
const closeUserSockets = (names) => {
  const list = Array.isArray(names) ? names : [names];

  for (const name of list) {
    const sockets = socketsByUser.get(name);
    if (sockets === undefined) continue;

    for (const socket of sockets) {
      // 第二个参数 true 表示同时关闭底层连接，客户端不会再自动恢复这条会话
      socket.disconnect(true);
    }
    socketsByUser.delete(name);
  }
};

module.exports = { registerUserSocket, unregisterUserSocket, closeUserSockets };
