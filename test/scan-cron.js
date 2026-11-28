// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const {
  formatDateTime,
  getDefaultTimezone,
  getNextRun,
  normalizeCronExpression,
  parseCron
} = require('../utils/cron');

describe('scan automation cron', function () {
  it('reads the default timezone from the container TZ variable', function () {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(getDefaultTimezone()).to.equal('America/New_York');
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });

  it('normalizes spacing and computes runs in the configured timezone', function () {
    const expression = normalizeCronExpression(' 0   3 *  * * ');

    expect(expression).to.equal('0 3 * * *');
    expect(getNextRun(expression, {
      from: new Date('2026-11-28T00:00:00.000Z'),
      timezone: 'Asia/Shanghai'
    })).to.equal('2026-11-28T19:00:00.000Z');
  });

  it('formats execution times using the backend timezone', function () {
    expect(formatDateTime(
      '2026-11-28T19:00:00.000Z',
      'Asia/Shanghai'
    )).to.include('03:00:00');
  });

  it('requires exactly five cron fields', function () {
    expect(() => parseCron('* * * * * *')).to.throw('Cron 表达式必须为五段');
  });

  it('rejects unsupported cron syntax', function () {
    expect(() => parseCron('61 * * * *')).to.throw('Cron 表达式无效');
  });
});
