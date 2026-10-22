// eslint-disable-next-line node/no-unpublished-require
const expect = require('chai').expect;
const {
  registerUserSocket,
  unregisterUserSocket,
  emitToUser
} = require('../state/userSockets');

describe('user socket delivery', function () {
  const userName = `history-user-${Date.now()}`;

  it('emits user-scoped events only to connected sockets', function () {
    const delivered = [];
    const connected = {
      connected: true,
      emit: (event, payload) => delivered.push({ event, payload })
    };
    const disconnected = {
      connected: false,
      emit: (event, payload) => delivered.push({ event, payload })
    };

    registerUserSocket(userName, connected);
    registerUserSocket(userName, disconnected);

    try {
      const count = emitToUser(userName, 'HISTORY_UPDATED', { workId: 1 });

      expect(count).to.equal(1);
      expect(delivered).to.deep.equal([
        { event: 'HISTORY_UPDATED', payload: { workId: 1 } }
      ]);
    } finally {
      unregisterUserSocket(userName, connected);
      unregisterUserSocket(userName, disconnected);
    }
  });

  it('does not deliver another user event', function () {
    expect(emitToUser(`${userName}-other`, 'HISTORY_UPDATED', {})).to.equal(0);
  });
});
