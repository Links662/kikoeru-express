// eslint-disable-next-line node/no-unpublished-require
const expect = require('chai').expect;
const knexFactory = require('knex');

const {
  getHistoryByWorkId,
  getHistoryGroupByWorkId
} = require('../database/db');

describe('history queries', function () {
  let knex;

  beforeEach(async function () {
    knex = knexFactory({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });

    await knex.schema
      .createTable('t_work', table => {
        table.increments('id').primary();
        table.boolean('nsfw').notNullable();
      })
      .createTable('t_history', table => {
        table.integer('work_id').notNullable();
        table.string('user_name').notNullable();
        table.integer('file_index').notNullable();
        table.string('file_name');
        table.integer('play_time');
        table.integer('total_time');
        table.timestamp('updated_at').notNullable();
        table.primary(['work_id', 'user_name']);
      });

    await knex('t_work').insert([
      { id: 1, nsfw: false },
      { id: 2, nsfw: true }
    ]);
    await knex('t_history').insert([
      {
        work_id: 1,
        user_name: 'alice',
        file_index: 0,
        file_name: 'all-ages.mp3',
        play_time: 10,
        total_time: 100,
        updated_at: '2026-10-30 10:00:00'
      },
      {
        work_id: 2,
        user_name: 'alice',
        file_index: 1,
        file_name: 'r18.mp3',
        play_time: 20,
        total_time: 100,
        updated_at: '2026-10-31 10:00:00'
      }
    ]);
  });

  afterEach(async function () {
    await knex.destroy();
  });

  it('includes nsfw in recent history records', async function () {
    const history = await getHistoryGroupByWorkId('alice', 20, knex);

    expect(history).to.have.length(2);
    expect(history.map(record => ({
      work_id: record.work_id,
      nsfw: record.nsfw
    }))).to.deep.equal([
      { work_id: 2, nsfw: 1 },
      { work_id: 1, nsfw: 0 }
    ]);
  });

  it('reads the current nsfw value every time history is queried', async function () {
    await knex('t_work').where('id', 1).update({ nsfw: true });

    const history = await getHistoryByWorkId('alice', 1, 0, knex);

    expect(history).to.include({ work_id: 1, nsfw: 1 });
  });
});
