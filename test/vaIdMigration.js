// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const migrationPath = path.join(__dirname, '../db-migrations/20261128_integerize_va_ids.sql');

const exec = (db, sql) => new Promise((resolve, reject) => {
  db.exec(sql, err => err ? reject(err) : resolve());
});

const all = (db, sql) => new Promise((resolve, reject) => {
  db.all(sql, (err, rows) => err ? reject(err) : resolve(rows));
});

const close = db => new Promise(resolve => db.close(resolve));

describe('voice actor integer ID migration', function () {
  let db;

  beforeEach(async function () {
    db = new sqlite3.Database(':memory:');
    await exec(db, `
      PRAGMA foreign_keys = ON;

      CREATE TABLE t_circle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
      CREATE TABLE t_work (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root_folder_id INTEGER NOT NULL,
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
        insert_time TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE t_tag (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
      CREATE TABLE t_va (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE r_tag_work (
        tag_id INTEGER,
        work_id INTEGER,
        PRIMARY KEY (tag_id, work_id)
      );
      CREATE TABLE r_va_work (
        va_id TEXT,
        work_id INTEGER,
        PRIMARY KEY (va_id, work_id),
        FOREIGN KEY (va_id) REFERENCES t_va (id) ON UPDATE CASCADE ON DELETE CASCADE,
        FOREIGN KEY (work_id) REFERENCES t_work (id) ON UPDATE CASCADE ON DELETE CASCADE
      );
      CREATE TABLE t_favourite (
        user_name TEXT NOT NULL,
        field TEXT NOT NULL,
        item_id TEXT NOT NULL,
        PRIMARY KEY (user_name, field, item_id)
      );

      INSERT INTO t_circle (id, name) VALUES (1, 'Circle');
      INSERT INTO t_work (id, root_folder_id, dir, title, circle_id)
        VALUES (1, 1, 'RJ100001', 'One', 1), (2, 1, 'RJ100002', 'Two', 1);
      INSERT INTO t_va (id, name) VALUES
        ('uuid-b', 'Same Name (CV)'),
        ('uuid-a', 'SameName'),
        ('uuid-c', 'Other [CV]');
      INSERT INTO r_va_work (va_id, work_id) VALUES
        ('uuid-b', 1),
        ('uuid-a', 1),
        ('uuid-c', 2);
      INSERT INTO t_favourite (user_name, field, item_id) VALUES
        ('alice', 'va', 'uuid-b'),
        ('alice', 'va', 'uuid-a'),
        ('bob', 'va', 'uuid-c');
    `);
  });

  afterEach(async function () {
    await close(db);
  });

  it('replaces UUIDs with compact integer IDs and preserves relations and favourites', async function () {
    await exec(db, fs.readFileSync(migrationPath, 'utf8'));

    const voiceActors = await all(db, 'SELECT id, name FROM t_va ORDER BY id');
    expect(voiceActors).to.deep.equal([
      { id: 1, name: 'SameName' },
      { id: 2, name: 'Other' }
    ]);

    const relations = await all(db, 'SELECT va_id, work_id FROM r_va_work ORDER BY work_id');
    expect(relations).to.deep.equal([
      { va_id: 1, work_id: 1 },
      { va_id: 2, work_id: 2 }
    ]);

    const favourites = await all(db, `
      SELECT user_name, field, item_id
      FROM t_favourite
      ORDER BY user_name
    `);
    expect(favourites).to.deep.equal([
      { user_name: 'alice', field: 'va', item_id: '1' },
      { user_name: 'bob', field: 'va', item_id: '2' }
    ]);

    const metadata = await all(db, 'SELECT id, vaObj FROM staticMetadata ORDER BY id');
    expect(JSON.parse(metadata[0].vaObj).vas).to.deep.equal([{ id: 1, name: 'SameName' }]);
    expect(await all(db, 'PRAGMA foreign_key_check')).to.deep.equal([]);
  });
});
