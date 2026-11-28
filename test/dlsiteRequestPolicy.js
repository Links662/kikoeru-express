// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;

const {
  isDlsiteBlockedError,
  isDlsiteChallengeResponse
} = require('../scraper/dlsite');

describe('DLsite request policy', function () {
  it('treats authentication, forbidden and rate-limit responses as blocking', function () {
    for (const status of [401, 403, 429]) {
      expect(isDlsiteBlockedError({ response: { status } })).to.equal(true);
    }
    expect(isDlsiteBlockedError({ response: { status: 500 } })).to.equal(false);
  });

  it('recognizes challenge pages without treating every HTML page as a block', function () {
    expect(isDlsiteChallengeResponse('<html><title>Just a moment...</title></html>'))
      .to.equal(true);
    expect(isDlsiteChallengeResponse('<html><title>Normal work page</title></html>'))
      .to.equal(false);
  });

});
