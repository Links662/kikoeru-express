// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;

const {
  nsfwFromAgeRating,
  nsfwFromSfwFlag
} = require('../scraper/utils');

describe('scraper nsfw defaults', function () {
  it('treats a missing or empty DLsite age rating as R18', function () {
    expect(nsfwFromAgeRating(undefined)).to.equal(true);
    expect(nsfwFromAgeRating('')).to.equal(true);
    expect(nsfwFromAgeRating('   ')).to.equal(true);
  });

  it('recognizes explicit DLsite age ratings', function () {
    expect(nsfwFromAgeRating('R18')).to.equal(true);
    expect(nsfwFromAgeRating(' r18 ')).to.equal(true);
    expect(nsfwFromAgeRating('全年龄')).to.equal(false);
    expect(nsfwFromAgeRating('全年齢')).to.equal(false);
  });

  it('treats a missing or unexpected HVDB SFW flag as R18', function () {
    expect(nsfwFromSfwFlag(undefined)).to.equal(true);
    expect(nsfwFromSfwFlag('')).to.equal(true);
    expect(nsfwFromSfwFlag('false')).to.equal(true);
    expect(nsfwFromSfwFlag('unexpected')).to.equal(true);
  });

  it('only marks HVDB works as all-ages when SFW is explicitly true', function () {
    expect(nsfwFromSfwFlag('true')).to.equal(false);
    expect(nsfwFromSfwFlag(' TRUE ')).to.equal(false);
  });
});
