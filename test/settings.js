// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const knexFactory = require('knex');

const { config, getRuntimeConfig, setRuntimeConfig } = require('../config');
const { loadRuntimeSettings, saveRuntimeSettings } = require('../settings');

describe('SQLite runtime settings', function () {
  let knex;
  let originalRuntimeSettings;

  beforeEach(async function () {
    originalRuntimeSettings = getRuntimeConfig();
    knex = knexFactory({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });

    await knex.schema.createTable('t_app_setting', table => {
      table.string('key').primary();
      table.text('value').notNullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    await knex.schema.createTable('t_root_folder', table => {
      table.increments('id');
      table.string('name').notNullable().unique();
      table.text('path').notNullable().unique();
      table.integer('max_recursion_depth').notNullable().defaultTo(2);
    });
    await knex.schema.createTable('t_work', table => {
      table.increments('id');
      table.integer('root_folder_id').notNullable();
      table.string('dir').notNullable();
    });
  });

  afterEach(async function () {
    setRuntimeConfig(originalRuntimeSettings);
    await knex.destroy();
  });

  it('loads runtime settings and ordered root folders from SQLite', async function () {
    await knex('t_app_setting').insert([
      { key: 'pageSize', value: '36' },
      { key: 'rewindSeekTime', value: '10' }
    ]);
    const [firstId] = await knex('t_root_folder').insert({
      name: 'first', path: '/first', max_recursion_depth: 1
    });
    const [secondId] = await knex('t_root_folder').insert({
      name: 'second', path: '/second', max_recursion_depth: 3
    });

    await loadRuntimeSettings(knex);

    expect(config.pageSize).to.equal(36);
    expect(config.rewindSeekTime).to.equal(10);
    expect(config.forwardSeekTime).to.equal(30);
    expect(config.expiresIn).to.equal(2592000);
    expect(config.rootFolders).to.deep.equal([
      { id: firstId, name: 'first', path: '/first', maxRecursionDepth: 1 },
      { id: secondId, name: 'second', path: '/second', maxRecursionDepth: 3 }
    ]);
  });

  it('persists runtime settings and root folders in one transaction', async function () {
    const [rootId] = await knex('t_root_folder').insert({
      name: 'media',
      path: '/media',
      max_recursion_depth: 2
    });
    await knex('t_work').insert({
      dir: 'RJ123456',
      root_folder_id: rootId
    });

    await saveRuntimeSettings({
      pageSize: 48,
      expiresIn: 3600,
      skipCleanup: true,
      rootFolders: [
        { id: rootId, name: 'renamed', path: '/moved', maxRecursionDepth: 3 }
      ]
    }, knex);

    const settings = await knex('t_app_setting').orderBy('key');
    const settingsByKey = Object.fromEntries(settings.map(item => [item.key, item.value]));
    const roots = await knex('t_root_folder').select();
    const works = await knex('t_work').select();

    expect(config.pageSize).to.equal(48);
    expect(config.expiresIn).to.equal(3600);
    expect(config.skipCleanup).to.equal(true);
    expect(config.rootFolders).to.deep.equal([
      { id: rootId, name: 'renamed', path: '/moved', maxRecursionDepth: 3 }
    ]);
    expect(settingsByKey.pageSize).to.equal('48');
    expect(settingsByKey.expiresIn).to.equal('3600');
    expect(settingsByKey.skipCleanup).to.equal('true');
    expect(roots).to.have.length(1);
    expect(roots[0]).to.include({
      id: rootId,
      name: 'renamed',
      path: '/moved',
      max_recursion_depth: 3
    });
    expect(works[0]).to.include({
      root_folder_id: rootId,
      dir: 'RJ123456'
    });
  });

  it('refuses to load when the migration has not been applied', async function () {
    await knex.schema.dropTable('t_app_setting');

    try {
      await loadRuntimeSettings(knex);
      throw new Error('expected loadRuntimeSettings to fail');
    } catch (err) {
      expect(err.message).to.include('no such table');
      expect(err.message).to.not.include('db-migrations');
    }
  });
});
