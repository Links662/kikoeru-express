// eslint-disable-next-line node/no-unpublished-require
const expect = require('chai').expect;
const knexFactory = require('knex');

const { getLabelsPage } = require('../database/db');

describe('label list pagination', function () {
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
        table.integer('circle_id');
      })
      .createTable('t_circle', table => {
        table.increments('id').primary();
        table.string('name');
      })
      .createTable('t_tag', table => {
        table.increments('id').primary();
        table.string('name');
      })
      .createTable('t_va', table => {
        table.string('id').primary();
        table.string('name');
      })
      .createTable('r_tag_work', table => {
        table.integer('tag_id');
        table.integer('work_id');
      })
      .createTable('r_va_work', table => {
        table.string('va_id');
        table.integer('work_id');
      })
      .createTable('t_favourite', table => {
        table.string('user_name');
        table.string('field');
        table.string('item_id');
      });

    await knex('t_circle').insert([
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Beta' },
      { id: 3, name: 'Gamma' }
    ]);
    await knex('t_tag').insert([
      { id: 1, name: 'Action' },
      { id: 2, name: 'Sleep' }
    ]);
    await knex('t_va').insert([
      { id: 'v1', name: 'Alice' },
      { id: 'v2', name: 'Bob' }
    ]);
    await knex('t_work').insert([
      { id: 1, circle_id: 1 },
      { id: 2, circle_id: 2 },
      { id: 3, circle_id: 3 },
      { id: 4, circle_id: 1 }
    ]);
    await knex('r_tag_work').insert([
      { tag_id: 1, work_id: 1 },
      { tag_id: 2, work_id: 2 }
    ]);
    await knex('r_va_work').insert([
      { va_id: 'v1', work_id: 1 },
      { va_id: 'v2', work_id: 2 }
    ]);
    await knex('t_favourite').insert({
      user_name: 'alice',
      field: 'circle',
      item_id: '2'
    });
  });

  afterEach(async function () {
    await knex.destroy();
  });

  it('paginates circles with favourites first', async function () {
    const firstPage = await getLabelsPage({
      field: 'circle',
      username: 'alice',
      sortBy: 'favourite',
      sort: 'desc',
      page: 1,
      pageSize: 2,
      database: knex
    });

    expect(firstPage.totalCount).to.equal(3);
    expect(firstPage.currentPage).to.equal(1);
    expect(firstPage.items.map(item => ({
      name: item.name,
      favourite: item.favourite,
      count: item.count
    }))).to.deep.equal([
      { name: 'Beta', favourite: 1, count: 1 },
      { name: 'Alpha', favourite: 0, count: 2 }
    ]);

    const secondPage = await getLabelsPage({
      field: 'circle',
      username: 'alice',
      sortBy: 'favourite',
      sort: 'desc',
      page: 2,
      pageSize: 2,
      database: knex
    });
    expect(secondPage.items.map(item => item.name)).to.deep.equal(['Gamma']);
  });

  it('sorts by work count on the server', async function () {
    const page = await getLabelsPage({
      field: 'circle',
      username: 'alice',
      sortBy: 'count',
      sort: 'desc',
      page: 1,
      pageSize: 10,
      database: knex
    });

    expect(page.items.map(item => ({
      name: item.name,
      count: item.count
    }))).to.deep.equal([
      { name: 'Alpha', count: 2 },
      { name: 'Beta', count: 1 },
      { name: 'Gamma', count: 1 }
    ]);
  });

  it('searches tags and VAs on the server', async function () {
    const tags = await getLabelsPage({
      field: 'tag',
      username: 'alice',
      keyword: 'sle',
      sortBy: 'name',
      sort: 'asc',
      page: 1,
      pageSize: 10,
      database: knex
    });
    const vas = await getLabelsPage({
      field: 'va',
      username: 'alice',
      keyword: 'bob',
      sortBy: 'name',
      sort: 'asc',
      page: 1,
      pageSize: 10,
      database: knex
    });

    expect(tags.totalCount).to.equal(1);
    expect(tags.items.map(item => item.name)).to.deep.equal(['Sleep']);
    expect(vas.totalCount).to.equal(1);
    expect(vas.items.map(item => item.name)).to.deep.equal(['Bob']);
  });
});
