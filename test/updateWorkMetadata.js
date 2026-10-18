// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const knexFactory = require('knex');

const { applyWorkMetadataUpdate } = require('../database/db');

describe('work metadata updates', function () {
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
        table.string('root_folder').notNullable();
        table.string('dir').notNullable();
        table.string('title').notNullable();
        table.integer('circle_id').notNullable();
        table.boolean('nsfw').notNullable().defaultTo(true);
        table.string('release');
        table.integer('dl_count');
        table.integer('price');
        table.integer('review_count');
        table.integer('rate_count');
        table.float('rate_average_2dp');
        table.text('rate_count_detail');
        table.text('rank');
      })
      .createTable('t_tag', table => {
        table.increments('id').primary();
        table.string('name').notNullable();
      })
      .createTable('t_va', table => {
        table.string('id').primary();
        table.string('name').notNullable();
      })
      .createTable('r_tag_work', table => {
        table.integer('tag_id');
        table.integer('work_id');
        table.primary(['tag_id', 'work_id']);
      })
      .createTable('r_va_work', table => {
        table.string('va_id');
        table.integer('work_id');
        table.primary(['va_id', 'work_id']);
      });

    await knex('t_circle').insert([
      { id: 1, name: 'Old circle' },
      { id: 2, name: 'Another circle' }
    ]);
    await knex('t_work').insert({
      id: 100,
      root_folder: 'root',
      dir: 'RJ000000',
      title: 'Old title',
      circle_id: 1,
      nsfw: false,
      release: '2020-01-01',
      dl_count: 1
    });
    await knex('t_tag').insert([
      { id: 1, name: 'Stale tag' },
      { id: 2, name: 'Old tag name' }
    ]);
    await knex('r_tag_work').insert([
      { tag_id: 1, work_id: 100 },
      { tag_id: 2, work_id: 100 }
    ]);
    await knex('t_va').insert({ id: 'old-va', name: 'Old VA' });
    await knex('r_va_work').insert({ va_id: 'old-va', work_id: 100 });
  });

  afterEach(async function () {
    await knex.destroy();
  });

  const metadata = overrides => ({
    id: 100,
    title: 'New title',
    nsfw: true,
    release: '2026-10-18',
    circle: { id: 3, name: 'New circle' },
    tags: [],
    vas: [],
    ...overrides
  });

  it('updates circle ownership and rebuilds the work tag list', async function () {
    await applyWorkMetadataUpdate(knex, metadata({
      dl_count: 42,
      price: 550,
      review_count: 7,
      rate_count: 8,
      rate_average_2dp: 4.5,
      rate_count_detail: [{ review_point: 5, count: 8, ratio: 100 }],
      rank: [{ term: 'day', category: 'all', rank: 3, rank_date: '2026-10-18' }],
      tags: [
        { id: 2, name: 'Fresh tag name' },
        { id: 4, name: 'New tag' }
      ],
      vas: [{ id: 'new-va', name: 'New VA' }]
    }), { refreshAll: true });

    const work = await knex('t_work').where('id', 100).first();
    expect(work).to.include({
      title: 'New title',
      circle_id: 3,
      nsfw: 1,
      release: '2026-10-18',
      dl_count: 42,
      price: 550,
      review_count: 7,
      rate_count: 8
    });
    expect(work.rate_average_2dp).to.equal(4.5);
    expect(JSON.parse(work.rate_count_detail)).to.deep.equal([
      { review_point: 5, count: 8, ratio: 100 }
    ]);
    expect(JSON.parse(work.rank)).to.deep.equal([
      { term: 'day', category: 'all', rank: 3, rank_date: '2026-10-18' }
    ]);

    const circle = await knex('t_circle').where('id', 3).first();
    expect(circle.name).to.equal('New circle');

    const tagIds = await knex('r_tag_work')
      .where('work_id', 100)
      .orderBy('tag_id')
      .pluck('tag_id');
    expect(tagIds).to.deep.equal([2, 4]);
    expect((await knex('t_tag').where('id', 2).first()).name).to.equal('Fresh tag name');
    expect((await knex('t_tag').where('id', 4).first()).name).to.equal('New tag');

    const vaIds = await knex('r_va_work').where('work_id', 100).pluck('va_id');
    expect(vaIds).to.deep.equal(['new-va']);
  });

  it('renames the existing circle when the circle id is unchanged', async function () {
    await applyWorkMetadataUpdate(knex, metadata({
      circle: { id: 1, name: 'Renamed circle' }
    }), { refreshAll: true });

    const work = await knex('t_work').where('id', 100).first();
    expect(work.circle_id).to.equal(1);
    expect((await knex('t_circle').where('id', 1).first()).name).to.equal('Renamed circle');
  });
});
