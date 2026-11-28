// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const scannerState = require('../state/scannerState');

describe('scanner state', function () {
  it('rejects unknown scan kinds instead of falling back to scan', function () {
    expect(() => scannerState.startScan('unknown')).to.throw(
      '未知扫描类型: unknown'
    );
  });

  it('requires an explicit scan kind', function () {
    expect(() => scannerState.startScan()).to.throw(
      '未知扫描类型: undefined'
    );
  });
});
