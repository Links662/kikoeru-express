// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const express = require('express');
const axios = require('axios');
const { config } = require('../config');
const scannerRoutes = require('../routes/scanner');

describe('scanner automation routes', function () {
  let server;
  let baseUrl;
  let originalAuth;

  before(function (done) {
    originalAuth = config.auth;
    config.auth = false;
    const app = express();
    app.use(express.json());
    app.use('/api/scanner', scannerRoutes);
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after(function (done) {
    config.auth = originalAuth;
    server.close(done);
  });

  it('no longer exposes the preview endpoint', async function () {
    let response;
    try {
      await axios.post(`${baseUrl}/api/scanner/automations/preview`, {
        cronExpression: '0 3 * * *'
      });
    } catch (err) {
      response = err.response;
    }

    expect(response.status).to.equal(404);
  });

  it('validates cron input when creating an automation', async function () {
    let response;
    try {
      await axios.post(`${baseUrl}/api/scanner/automations`, {
        type: 'scan',
        cronExpression: '0 0 3 * * *',
        enabled: true
      });
    } catch (err) {
      response = err.response;
    }

    expect(response.status).to.equal(400);
    expect(response.data.errors[0].msg).to.include('必须为五段');
  });

  it('requires administrator access when authentication is enabled', async function () {
    config.auth = true;
    let response;
    try {
      await axios.post(`${baseUrl}/api/scanner/automations`, {
        type: 'scan',
        cronExpression: '0 3 * * *',
        enabled: true
      });
    } catch (err) {
      response = err.response;
    } finally {
      config.auth = false;
    }

    expect(response.status).to.equal(403);
  });
});
