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
const rootFolderIdMigrationPath = path.join(
  __dirname,
  '../db-migrations/20261125_add_work_root_folder_id.sql'
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

  it('adds and backfills the work root folder foreign key', async function () {
    const database = new sqlite3.Database(':memory:');

    try {
      await exec(database, `
        CREATE TABLE t_circle (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL
        );
        CREATE TABLE t_tag (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL
        );
        CREATE TABLE t_va (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        );
        CREATE TABLE t_work (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          root_folder TEXT NOT NULL,
          dir TEXT NOT NULL,
          title TEXT NOT NULL,
          circle_id INTEGER NOT NULL,
          nsfw INTEGER NOT NULL DEFAULT 1,
          subtitle INTEGER NOT NULL DEFAULT 0,
          release TEXT,
          dl_count INTEGER,
          price INTEGER,
          review_count INTEGER,
          rate_count INTEGER,
          rate_average_2dp REAL,
          rate_count_detail TEXT,
          rank TEXT,
          insert_time DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE r_tag_work (
          tag_id INTEGER,
          work_id INTEGER
        );
        CREATE TABLE r_va_work (
          va_id TEXT,
          work_id INTEGER
        );
      `);
      await exec(database, fs.readFileSync(migrationPath, 'utf8'));
      await exec(database, `
        INSERT INTO t_circle (id, name) VALUES (1, 'circle');
        INSERT INTO t_root_folder (name, path, max_recursion_depth, position)
        VALUES ('media', '/media', 2, 0);
        INSERT INTO t_work (root_folder, dir, title, circle_id)
        VALUES ('media', 'RJ123456', 'title', 1);
      `);
      await exec(database, fs.readFileSync(rootFolderIdMigrationPath, 'utf8'));

      const columns = await all(database, 'PRAGMA table_info(t_work)');
      const foreignKeys = await all(database, 'PRAGMA foreign_key_list(t_work)');
      const works = await all(database, 'SELECT root_folder_id FROM t_work');
      const foreignKeyErrors = await all(database, 'PRAGMA foreign_key_check');

      expect(columns.map(column => column.name)).to.include('root_folder_id');
      expect(columns.map(column => column.name)).to.not.include('root_folder');
      expect(foreignKeys.find(key => key.from === 'root_folder_id')).to.deep.include({
        table: 't_root_folder',
        from: 'root_folder_id',
        to: 'id',
        on_update: 'CASCADE',
        on_delete: 'RESTRICT',
        match: 'NONE'
      });
      expect(works[0].root_folder_id).to.equal(1);
      expect(foreignKeyErrors).to.deep.equal([]);
    } finally {
      await new Promise(resolve => database.close(resolve));
    }
  });
});
