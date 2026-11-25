// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;

const {
  createLog,
  formatConsoleLog,
  LOG_DEPTH
} = require('../filesystem/scannerLog');

describe('scanner logs', function () {
  it('preserves the complete message and assigns semantic depth', function () {
    const log = createLog('[RJ01731224] 存在多个文件夹.', {
      level: 'warn',
      type: 'item',
      workId: '1731224'
    });

    expect(log.message).to.equal('[RJ01731224] 存在多个文件夹.');
    expect(log.level).to.equal('warn');
    expect(log.type).to.equal('item');
    expect(log.depth).to.equal(LOG_DEPTH.item);
    expect(log.workId).to.equal(1731224);
    expect(log.id).to.be.a('number');
    expect(log.timestamp).to.be.a('number');
  });

  it('formats console output with depth-based indentation', function () {
    const log = createLog('写入数据库失败', {
      level: 'error',
      type: 'detail'
    });

    expect(formatConsoleLog(log)).to.equal('      ✕ 写入数据库失败');
  });

  it('falls back to safe defaults for unknown metadata', function () {
    const log = createLog('普通日志', {
      level: 'fatal',
      type: 'unknown'
    });

    expect(log.level).to.equal('info');
    expect(log.type).to.equal('progress');
    expect(log.depth).to.equal(LOG_DEPTH.progress);
    expect(log).to.not.have.property('workId');
  });
});
