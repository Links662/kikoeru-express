// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const knexFactory = require('knex');
const path = require('path');
const sqlite3 = require('sqlite3');

const { getWorksDueForMetadataRefresh } = require('../database/db');

const DAY = 24 * 60 * 60 * 1000;
const sqliteTime = time => new Date(time)
  .toISOString()
  .replace('T', ' ')
  .slice(0, 19);
const migrationPath = path.join(
  __dirname,
  '../db-migrations/20261128_add_work_update_time.sql'
);

const exec = (database, sql) => new Promise((resolve, reject) => {
  database.exec(sql, error => error ? reject(error) : resolve());
});

const all = (database, sql) => new Promise((resolve, reject) => {
  database.all(sql, (error, rows) => error ? reject(error) : resolve(rows));
});

describe('metadata refresh selection', function () {
  let database;
  const now = 2_000_000_000_000;

  beforeEach(async function () {
    database = knexFactory({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });

    await database.schema.createTable('t_work', table => {
      table.increments('id').primary();
      table.timestamp('update_time');
    });
    await database('t_work').insert([
      { id: 1, update_time: null },
      { id: 2, update_time: sqliteTime(now - 9 * DAY) },
      { id: 3, update_time: sqliteTime(now - 2 * DAY) },
      { id: 4, update_time: sqliteTime(now - 20 * DAY) },
      { id: 5, update_time: sqliteTime(now - 7 * DAY) },
      { id: 6, update_time: '2099-01-01 00:00:00' }
    ]);
  });

  afterEach(async function () {
    await database.destroy();
  });

  it('selects never-updated works first, then the oldest stale works up to the batch limit', async function () {
    const works = await getWorksDueForMetadataRefresh({
      batchSize: 3,
      staleDays: 7,
      now
    }, database);

    expect(works.map(work => work.id)).to.deep.equal([1, 4, 2]);
  });

  it('does not select works updated within the configured interval', async function () {
    const works = await getWorksDueForMetadataRefresh({
      batchSize: 10,
      staleDays: 7,
      now
    }, database);

    expect(works.map(work => work.id)).to.deep.equal([1, 4, 2, 5]);
  });

  it('adds and backfills update_time through the manual migration', async function () {
    const databaseConnection = new sqlite3.Database(':memory:');

    try {
      await exec(databaseConnection, `
        CREATE TABLE t_work (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          insert_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO t_work (id, insert_time)
        VALUES (1, '2026-11-01 00:00:00');
      `);
      await exec(databaseConnection, fs.readFileSync(migrationPath, 'utf8'));

      const columns = await all(databaseConnection, 'PRAGMA table_info(t_work)');
      const indexes = await all(databaseConnection, 'PRAGMA index_list(t_work)');
      const works = await all(databaseConnection, 'SELECT update_time FROM t_work');

      expect(columns.map(column => column.name)).to.include('update_time');
      expect(indexes.map(index => index.name)).to.include('idx_t_work_update_time');
      expect(works).to.deep.equal([{ update_time: '2026-11-01 00:00:00' }]);
    } finally {
      await new Promise(resolve => databaseConnection.close(resolve));
    }
  });
});
