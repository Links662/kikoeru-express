// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const migrationPath = path.join(
  __dirname,
  '../db-migrations/20261125_split_runtime_config_to_sqlite.sql'
);

const exec = (database, sql) => new Promise((resolve, reject) => {
  database.exec(sql, err => err ? reject(err) : resolve());
});

const all = (database, sql) => new Promise((resolve, reject) => {
  database.all(sql, (err, rows) => err ? reject(err) : resolve(rows));
});

describe('runtime settings migration', function () {
  it('creates settings tables and seeds defaults', async function () {
    const database = new sqlite3.Database(':memory:');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    try {
      await exec(database, sql);

      const tables = await all(
        database,
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      );
      const pageSize = await all(
        database,
        "SELECT value FROM t_app_setting WHERE key = 'pageSize'"
      );
      const foreignKeyErrors = await all(database, 'PRAGMA foreign_key_check');

      expect(tables.map(row => row.name)).to.include.members([
        't_app_setting',
        't_root_folder'
      ]);
      expect(pageSize).to.deep.equal([{ value: '12' }]);
      expect(foreignKeyErrors).to.deep.equal([]);
    } finally {
      await new Promise(resolve => database.close(resolve));
    }
  });
});
