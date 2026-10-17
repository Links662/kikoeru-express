// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;

const { formatRJLabel } = require('../utils/workId');

describe('work id formatting', function () {
  it('formats 6-digit RJ ids', function () {
    expect(formatRJLabel(300650)).to.equal('RJ300650');
    expect(formatRJLabel('083523')).to.equal('RJ083523');
    expect(formatRJLabel(441526)).to.equal('RJ441526');
  });

  it('formats 8-digit RJ ids with a leading zero', function () {
    expect(formatRJLabel(1690443)).to.equal('RJ01690443');
    expect(formatRJLabel(1000108)).to.equal('RJ01000108');
    expect(formatRJLabel(1731224)).to.equal('RJ01731224');
  });

  it('rejects empty or non-numeric ids', function () {
    expect(() => formatRJLabel('')).to.throw(TypeError);
    expect(() => formatRJLabel('RJ01731224')).to.throw(TypeError);
    expect(() => formatRJLabel(null)).to.throw(TypeError);
  });
});
