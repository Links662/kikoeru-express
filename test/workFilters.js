// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const knexFactory = require('knex');

const { applyWorkFilters, applyWorkConditions } = require('../database/db');

const migrationPath = path.join(
  __dirname,
  '../db-migrations/20261018_make_t_work_nsfw_not_null.sql'
);

const exec = (db, sql) => new Promise((resolve, reject) => {
  db.exec(sql, err => err ? reject(err) : resolve());
});

const all = (db, sql) => new Promise((resolve, reject) => {
  db.all(sql, (err, rows) => err ? reject(err) : resolve(rows));
});

const close = db => new Promise(resolve => db.close(resolve));

describe('work filters', function () {
  let knex;

  beforeEach(async function () {
    knex = knexFactory({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });

    await knex.schema
      .createTable('staticMetadata', table => {
        table.integer('id');
        table.string('title');
        table.integer('circle_id');
        table.boolean('nsfw');
        table.boolean('subtitle');
      })
      .createTable('t_circle', table => {
        table.integer('id');
        table.string('name');
      })
      .createTable('t_tag', table => {
        table.integer('id');
        table.string('name');
      })
      .createTable('t_va', table => {
        table.string('id');
        table.string('name');
      })
      .createTable('r_tag_work', table => {
        table.integer('tag_id');
        table.integer('work_id');
      })
      .createTable('r_va_work', table => {
        table.string('va_id');
        table.integer('work_id');
      });

    await knex('t_circle').insert([
      { id: 1, name: 'circle one' },
      { id: 2, name: 'circle two' }
    ]);
    await knex('t_tag').insert([
      { id: 1, name: 'sleep' },
      { id: 2, name: 'asmr' },
      { id: 3, name: 'voice' }
    ]);
    await knex('t_va').insert([
      { id: 'v1', name: 'alice' },
      { id: 'v2', name: 'bob' }
    ]);
    await knex('staticMetadata').insert([
      { id: 1, title: 'Alpha sleep', circle_id: 1, nsfw: false, subtitle: false },
      { id: 2, title: 'Beta asmr', circle_id: 1, nsfw: false, subtitle: true },
      { id: 3, title: 'Gamma alice', circle_id: 2, nsfw: true, subtitle: true },
      { id: 4, title: 'Delta sleep', circle_id: 2, nsfw: true, subtitle: false }
    ]);
    await knex('r_tag_work').insert([
      { tag_id: 1, work_id: 1 },
      { tag_id: 2, work_id: 1 },
      { tag_id: 2, work_id: 2 },
      { tag_id: 3, work_id: 3 },
      { tag_id: 1, work_id: 4 },
      { tag_id: 3, work_id: 4 }
    ]);
    await knex('r_va_work').insert([
      { va_id: 'v1', work_id: 1 },
      { va_id: 'v2', work_id: 2 },
      { va_id: 'v1', work_id: 3 },
      { va_id: 'v2', work_id: 4 }
    ]);
  });

  afterEach(async function () {
    await knex.destroy();
  });

  const getIds = async (filters) => {
    const rows = await applyWorkFilters(
      knex('staticMetadata').select('id').orderBy('id'),
      filters
    );
    return rows.map(row => row.id);
  };

  it('does not filter when both filters are omitted', async function () {
    expect(await getIds({})).to.deep.equal([1, 2, 3, 4]);
  });

  it('filters all-ages works', async function () {
    expect(await getIds({ nsfw: false })).to.deep.equal([1, 2]);
  });

  it('filters R18 works', async function () {
    expect(await getIds({ nsfw: true })).to.deep.equal([3, 4]);
  });

  it('filters subtitled works', async function () {
    expect(await getIds({ subtitle: true })).to.deep.equal([2, 3]);
  });

  it('combines nsfw and subtitle filters', async function () {
    expect(await getIds({ nsfw: true, subtitle: true })).to.deep.equal([3]);
  });

  const getConditionIds = async (conditions, filters = {}) => {
    const rows = await applyWorkConditions(
      applyWorkFilters(
        knex('staticMetadata').select('id').orderBy('id'),
        filters
      ),
      conditions
    );
    return rows.map(row => row.id);
  };

  it('filters multiple circles with OR semantics', async function () {
    expect(await getConditionIds({ circleIds: [1, 2] })).to.deep.equal([1, 2, 3, 4]);
    expect(await getConditionIds({ circleIds: [1] })).to.deep.equal([1, 2]);
  });

  it('filters multiple tags with OR semantics without duplicate works', async function () {
    expect(await getConditionIds({ tagIds: [1, 2] })).to.deep.equal([1, 2, 4]);
  });

  it('filters multiple VAs with OR semantics', async function () {
    expect(await getConditionIds({ vaIds: ['v1', 'v2'] })).to.deep.equal([1, 2, 3, 4]);
  });

  it('combines different condition groups with AND semantics', async function () {
    expect(await getConditionIds({
      circleIds: [1],
      tagIds: [2],
      vaIds: ['v1']
    })).to.deep.equal([1]);
  });

  it('combines a keyword with selected condition groups', async function () {
    expect(await getConditionIds({
      keyword: 'sleep',
      circleIds: [2],
      vaIds: ['v2']
    })).to.deep.equal([4]);
  });

  it('searches title, circle, tag and VA names', async function () {
    expect(await getConditionIds({ keyword: 'Alpha' })).to.deep.equal([1]);
    expect(await getConditionIds({ keyword: 'circle two' })).to.deep.equal([3, 4]);
    expect(await getConditionIds({ keyword: 'sleep' })).to.deep.equal([1, 4]);
    expect(await getConditionIds({ keyword: 'alice' })).to.deep.equal([1, 3]);
  });

  it('keeps age and subtitle filters after grouped condition clauses', async function () {
    expect(await getConditionIds(
      { tagIds: [1, 2] },
      { nsfw: false, subtitle: true }
    )).to.deep.equal([2]);
  });

  it('matches an RJ number exactly', async function () {
    expect(await getConditionIds({ keyword: 'RJ000003' })).to.deep.equal([3]);
  });
});

describe('t_work.nsfw NOT NULL migration', function () {
  let db;

  beforeEach(async function () {
    db = new sqlite3.Database(':memory:');

    await exec(db, `
      PRAGMA foreign_keys = ON;

      CREATE TABLE t_circle (
        id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
        name varchar(255) NOT NULL
      );

      CREATE TABLE t_work (
        id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
        root_folder varchar(255) NOT NULL,
        dir varchar(255) NOT NULL,
        title varchar(255) NOT NULL,
        circle_id integer NOT NULL,
        nsfw boolean,
        subtitle boolean NOT NULL DEFAULT 0,
        release varchar(255),
        dl_count integer,
        price integer,
        review_count integer,
        rate_count integer,
        rate_average_2dp float,
        rate_count_detail text,
        rank text,
        insert_time datetime DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (circle_id) REFERENCES t_circle (id) ON UPDATE CASCADE ON DELETE CASCADE
      );

      CREATE TABLE t_tag (
        id integer NOT NULL PRIMARY KEY AUTOINCREMENT,
        name varchar(255) NOT NULL
      );

      CREATE TABLE t_va (
        id varchar(255) NOT NULL PRIMARY KEY,
        name varchar(255) NOT NULL
      );

      CREATE TABLE r_tag_work (
        tag_id integer,
        work_id integer,
        PRIMARY KEY (tag_id, work_id),
        FOREIGN KEY (tag_id) REFERENCES t_tag (id) ON UPDATE CASCADE ON DELETE CASCADE,
        FOREIGN KEY (work_id) REFERENCES t_work (id) ON UPDATE CASCADE ON DELETE CASCADE
      );

      CREATE TABLE r_va_work (
        va_id varchar(255),
        work_id integer,
        PRIMARY KEY (va_id, work_id),
        FOREIGN KEY (va_id) REFERENCES t_va (id) ON UPDATE CASCADE ON DELETE CASCADE,
        FOREIGN KEY (work_id) REFERENCES t_work (id) ON UPDATE CASCADE ON DELETE CASCADE
      );

      CREATE INDEX t_work_index ON t_work (circle_id, release);

      INSERT INTO t_circle (id, name) VALUES (1, 'circle');
      INSERT INTO t_work (
        id, root_folder, dir, title, circle_id, nsfw, subtitle, release
      ) VALUES
        (1, 'root', 'dir1', 'unknown-age', 1, NULL, 0, '2020-01-01'),
        (2, 'root', 'dir2', 'all-ages', 1, 0, 1, '2020-01-02'),
        (3, 'root', 'dir3', 'r18', 1, 1, 0, '2020-01-03');
    `);
  });

  afterEach(async function () {
    await close(db);
  });

  it('backfills NULL as R18 and rebuilds t_work with a NOT NULL nsfw column', async function () {
    await exec(db, fs.readFileSync(migrationPath, 'utf8'));

    const columns = await all(db, 'PRAGMA table_info(t_work)');
    const nsfwColumn = columns.find(column => column.name === 'nsfw');

    expect(nsfwColumn.notnull).to.equal(1);
    expect(nsfwColumn.dflt_value).to.equal('1');

    const works = await all(db, 'SELECT id, nsfw, subtitle FROM t_work ORDER BY id');
    expect(works).to.deep.equal([
      { id: 1, nsfw: 1, subtitle: 0 },
      { id: 2, nsfw: 0, subtitle: 1 },
      { id: 3, nsfw: 1, subtitle: 0 }
    ]);

    const viewColumns = await all(db, 'PRAGMA table_info(staticMetadata)');
    const viewColumnNames = viewColumns.map(column => column.name);
    expect(viewColumnNames).to.include('circle_name');
    expect(viewColumnNames).to.include('subtitle');

    const foreignKeyErrors = await all(db, 'PRAGMA foreign_key_check');
    expect(foreignKeyErrors).to.deep.equal([]);
  });

  it('rejects inserting a NULL nsfw value', async function () {
    await exec(db, fs.readFileSync(migrationPath, 'utf8'));

    const error = await new Promise(resolve => {
      db.run(`
        INSERT INTO t_work (root_folder, dir, title, circle_id, nsfw)
        VALUES ('root', 'dir4', 'invalid', 1, NULL)
      `, err => resolve(err));
    });

    expect(error).to.be.an('error');
    expect(error.message).to.include('NOT NULL constraint failed: t_work.nsfw');
  });
});
