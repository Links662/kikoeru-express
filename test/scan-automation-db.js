// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const createKnex = require('knex');
const {
  createScanAutomation,
  deleteScanAutomation,
  getScanAutomations,
  updateScanAutomation,
  updateScanAutomationTrigger
} = require('../database/db');

describe('scan automation persistence', function () {
  let database;

  beforeEach(async function () {
    database = createKnex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      pool: { min: 1, max: 1 },
      useNullAsDefault: true
    });
    await database.schema.createTable('t_scan_automation', table => {
      table.increments('id');
      table.string('type', 32).notNullable();
      table.string('cron_expression', 128).notNullable();
      table.boolean('enabled').notNullable().defaultTo(true);
      table.timestamp('last_triggered_at');
      table.string('last_trigger_status', 32);
      table.timestamp('created_at').notNullable().defaultTo(database.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(database.fn.now());
      table.unique(['type', 'cron_expression']);
    });
  });

  afterEach(async function () {
    await database.destroy();
  });

  it('creates, updates, triggers and deletes an automation', async function () {
    const created = await createScanAutomation({
      type: 'subtitles',
      cronExpression: '0 3 * * *',
      enabled: true
    }, database);

    expect(created).to.include({
      type: 'subtitles',
      cronExpression: '0 3 * * *',
      enabled: true
    });

    const updated = await updateScanAutomation(created.id, {
      cronExpression: '30 4 * * 0'
    }, database);
    expect(updated.cronExpression).to.equal('30 4 * * 0');

    await updateScanAutomationTrigger(created.id, {
      status: 'skipped_busy',
      triggeredAt: '2026-11-29T20:30:00.000Z'
    }, database);
    const rows = await getScanAutomations(database);
    expect(rows[0].lastTriggerStatus).to.equal('skipped_busy');
    expect(rows[0].lastTriggeredAt).to.equal('2026-11-29T20:30:00.000Z');

    expect(await deleteScanAutomation(created.id, database)).to.equal(true);
    expect(await getScanAutomations(database)).to.deep.equal([]);
  });

  it('rejects duplicate operation and cron combinations', async function () {
    const automation = {
      type: 'covers',
      cronExpression: '0 2 * * *',
      enabled: true
    };
    await createScanAutomation(automation, database);

    let error;
    try {
      await createScanAutomation(automation, database);
    } catch (err) {
      error = err;
    }
    expect(error).to.be.an('error');
    expect(error.code).to.equal('SQLITE_CONSTRAINT');
  });
});
