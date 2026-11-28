// eslint-disable-next-line node/no-unpublished-require
const expect = require('chai').expect;
const knexFactory = require('knex');

const { upsertTagCatalog } = require('../database/db');

describe('tag catalog persistence', function () {
  let knex;

  beforeEach(async function () {
    knex = knexFactory({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });
    await knex.schema.createTable('t_tag', table => {
      table.increments('id');
      table.string('name').notNullable();
    });
    await knex.schema.createTable('t_tag_translation', table => {
      table.integer('id').notNullable();
      table.string('locale').notNullable();
      table.string('name').notNullable().defaultTo('');
      table.primary(['id', 'locale']);
    });
  });

  afterEach(async function () {
    await knex.destroy();
  });

  it('inserts new tags and updates all localized names', async function () {
    await knex('t_tag').insert({ id: 14, name: '旧标签' });
    await knex('t_tag_translation').insert([
      { id: 14, locale: 'ja-jp', name: '旧标签' },
      { id: 14, locale: 'zh-cn', name: '旧中文' },
      { id: 14, locale: 'zh-tw', name: '舊中文' }
    ]);

    const counts = await upsertTagCatalog([
      { id: 14, locale: 'ja-jp', name: '恋人同士' },
      { id: 14, locale: 'zh-cn', name: '情侣' },
      { id: 14, locale: 'zh-tw', name: '情侶/戀人' },
      { id: 497, locale: 'ja-jp', name: 'ASMR' },
      { id: 497, locale: 'zh-cn', name: 'ASMR' },
      { id: 497, locale: 'zh-tw', name: 'ASMR' }
    ], knex);

    expect(counts).to.deep.equal({ inserted: 1, updated: 1 });
    expect(await knex('t_tag_translation').where('id', 14).orderBy('locale').select('locale', 'name'))
      .to.deep.equal([
        { locale: 'ja-jp', name: '恋人同士' },
        { locale: 'zh-cn', name: '情侣' },
        { locale: 'zh-tw', name: '情侶/戀人' }
      ]);
    expect(await knex('t_tag_translation').where('id', 497).count({ count: '*' }).first())
      .to.deep.equal({ count: 3 });
    expect((await knex('t_tag').where('id', 14).first()).name).to.equal('情侣');
    expect((await knex('t_tag').where('id', 497).first()).name).to.equal('ASMR');
  });

  it('keeps a previous translation when a later catalog omits that language', async function () {
    await knex('t_tag').insert({ id: 14, name: '旧标签' });
    await knex('t_tag_translation').insert([
      { id: 14, locale: 'ja-jp', name: '旧标签' },
      { id: 14, locale: 'zh-tw', name: '舊譯名' }
    ]);

    await upsertTagCatalog([
      { id: 14, locale: 'ja-jp', name: '恋人同士' },
      { id: 14, locale: 'zh-cn', name: '情侣' }
    ], knex);

    expect(await knex('t_tag_translation').where('id', 14).orderBy('locale').select('locale', 'name'))
      .to.deep.equal([
        { locale: 'ja-jp', name: '恋人同士' },
        { locale: 'zh-cn', name: '情侣' },
        { locale: 'zh-tw', name: '舊譯名' }
      ]);
  });
});
