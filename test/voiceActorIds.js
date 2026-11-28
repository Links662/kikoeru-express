// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const knexFactory = require('knex');

const { insertWorkMetadata } = require('../database/db');

describe('voice actor integer IDs', function () {
  let knex;

  beforeEach(async function () {
    knex = knexFactory({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });

    await knex.schema
      .createTable('t_circle', table => {
        table.increments('id').primary();
        table.string('name').notNullable();
      })
      .createTable('t_work', table => {
        table.increments('id').primary();
        table.integer('root_folder_id').notNullable();
        table.string('dir').notNullable();
        table.string('title').notNullable();
        table.integer('circle_id').notNullable();
        table.boolean('nsfw').notNullable().defaultTo(true);
        table.boolean('subtitle').notNullable().defaultTo(false);
        table.string('release');
        table.integer('dl_count');
        table.integer('price');
        table.integer('review_count');
        table.integer('rate_count');
        table.float('rate_average_2dp');
        table.text('rate_count_detail');
        table.text('rank');
        table.timestamp('update_time').defaultTo(knex.fn.now());
        table.timestamp('insert_time').defaultTo(knex.fn.now());
      })
      .createTable('t_tag', table => {
        table.increments('id').primary();
        table.string('name').notNullable();
      })
      .createTable('t_va', table => {
        table.increments('id').primary();
        table.string('name').notNullable().unique();
      })
      .createTable('r_tag_work', table => {
        table.integer('tag_id');
        table.integer('work_id');
        table.primary(['tag_id', 'work_id']);
      })
      .createTable('r_va_work', table => {
        table.integer('va_id');
        table.integer('work_id');
        table.primary(['va_id', 'work_id']);
      });
  });

  afterEach(async function () {
    await knex.destroy();
  });

  const metadata = (id, vas) => ({
    id,
    rootFolderId: 1,
    dir: `RJ${String(id).padStart(6, '0')}`,
    title: `Work ${id}`,
    circle: { id: 1, name: 'Test circle' },
    nsfw: false,
    subtitle: false,
    release: '2026-11-28',
    tags: [],
    vas
  });

  it('assigns and reuses short integer IDs by exact voice actor name', async function () {
    await insertWorkMetadata(metadata(100, [{ name: 'Alice' }, { name: 'Alice' }]), knex);
    await insertWorkMetadata(metadata(101, [{ name: 'Alice' }, { name: 'Bob' }]), knex);

    const voiceActors = await knex('t_va').select('id', 'name').orderBy('id');
    expect(voiceActors).to.deep.equal([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ]);

    const relations = await knex('r_va_work')
      .select('va_id', 'work_id')
      .orderBy(['work_id', 'va_id']);
    expect(relations).to.deep.equal([
      { va_id: 1, work_id: 100 },
      { va_id: 1, work_id: 101 },
      { va_id: 2, work_id: 101 }
    ]);

    const works = await knex('t_work').select('update_time');
    works.forEach(work => expect(work.update_time).to.match(/^\d{4}-\d{2}-\d{2} /));
  });
});
