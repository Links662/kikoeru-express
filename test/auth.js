// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const jwt = require('jsonwebtoken');

const { config } = require('../config');
const { signToken } = require('../auth/utils');

describe('authentication token', function () {
  it('uses the configured expiry when signing a login token', function () {
    const token = signToken({
      name: 'admin',
      group: 'administrator'
    });
    const payload = jwt.decode(token);

    expect(payload.exp - payload.iat).to.equal(config.expiresIn);
  });
});
