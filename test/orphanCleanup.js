// eslint-disable-next-line node/no-unpublished-require
const expect = require('chai').expect;
const knexFactory = require('knex');

const { cleanupOrphanEntities } = require('../database/db');

describe('orphan entity cleanup', function () {
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
        table.integer('circle_id').notNullable();
      })
      .createTable('t_va', table => {
        table.increments('id').primary();
        table.string('name').notNullable().unique();
      })
      .createTable('t_tag', table => {
        table.increments('id').primary();
        table.string('name').notNullable();
      })
      .createTable('t_tag_translation', table => {
        table.integer('id').notNullable();
        table.string('locale').notNullable();
        table.string('name').notNullable();
        table.primary(['id', 'locale']);
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
      })
      .createTable('t_favourite', table => {
        table.string('user_name').notNullable();
        table.string('field').notNullable();
        table.string('item_id').notNullable();
        table.primary(['user_name', 'field', 'item_id']);
      });

    await knex('t_circle').insert([
      { id: 1, name: 'Used circle' },
      { id: 2, name: 'Orphan circle' }
    ]);
    await knex('t_work').insert({ id: 1, circle_id: 1 });
    await knex('t_va').insert([
      { id: 1, name: 'Used VA' },
      { id: 2, name: 'Orphan VA' }
    ]);
    await knex('t_tag').insert([
      { id: 1, name: 'Used tag' },
      { id: 2, name: 'Orphan tag' }
    ]);
    await knex('t_tag_translation').insert([
      { id: 1, locale: 'ja-jp', name: '使用中のタグ' },
      { id: 2, locale: 'ja-jp', name: '孤立タグ' }
    ]);
    await knex('r_tag_work').insert({ tag_id: 1, work_id: 1 });
    await knex('r_va_work').insert({ va_id: 1, work_id: 1 });
    await knex('t_favourite').insert([
      { user_name: 'user', field: 'circle', item_id: '1' },
      { user_name: 'user', field: 'circle', item_id: '2' },
      { user_name: 'user', field: 'tag', item_id: '1' },
      { user_name: 'user', field: 'tag', item_id: '2' },
      { user_name: 'user', field: 'va', item_id: '1' },
      { user_name: 'user', field: 'va', item_id: '2' }
    ]);
  });

  afterEach(async function () {
    await knex.destroy();
  });

  it('removes orphan tags, voice actors, circles and their favourites', async function () {
    const result = await cleanupOrphanEntities(knex);

    expect(result).to.deep.equal({ tagCount: 1, circleCount: 1, vaCount: 1 });
    expect(await knex('t_circle').select('id').orderBy('id')).to.deep.equal([{ id: 1 }]);
    expect(await knex('t_va').select('id').orderBy('id')).to.deep.equal([{ id: 1 }]);
    expect(await knex('t_tag').select('id').orderBy('id')).to.deep.equal([{ id: 1 }]);
    expect(await knex('t_tag_translation').select('id', 'locale').orderBy(['id', 'locale']))
      .to.deep.equal([
        { id: 1, locale: 'ja-jp' },
        { id: 2, locale: 'ja-jp' }
      ]);
    expect(await knex('t_favourite').select('field', 'item_id').orderBy(['field', 'item_id']))
      .to.deep.equal([
        { field: 'circle', item_id: '1' },
        { field: 'tag', item_id: '1' },
        { field: 'va', item_id: '1' }
      ]);
  });
});
