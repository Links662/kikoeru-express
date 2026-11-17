// eslint-disable-next-line node/no-unpublished-require
const expect = require('chai').expect;
const createKnex = require('knex');
const { updateUser } = require('../database/db');

describe('user updates', function () {
  let database;

  beforeEach(async function () {
    database = createKnex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true
    });

    await database.schema.createTable('t_user', (table) => {
      table.string('name').primary();
      table.string('password').notNullable();
      table.string('group').notNullable();
      table.integer('disabled').notNullable().defaultTo(0);
    });

    await database('t_user').insert([
      { name: 'admin', password: 'hash-admin', group: 'administrator', disabled: 0 },
      { name: 'admin-a', password: 'hash-a', group: 'administrator', disabled: 0 },
      { name: 'admin-b', password: 'hash-b', group: 'administrator', disabled: 0 },
      { name: 'listener', password: 'hash-c', group: 'user', disabled: 0 }
    ]);
  });

  afterEach(async function () {
    await database.destroy();
  });

  it('changes only the group and preserves the password', async function () {
    const result = await updateUser({ name: 'listener', group: 'administrator' }, database);
    const user = await database('t_user').where('name', 'listener').first();

    expect(result.groupChanged).to.equal(true);
    expect(result.passwordChanged).to.equal(false);
    expect(user.group).to.equal('administrator');
    expect(user.password).to.equal('hash-c');
  });

  it('changes the password without touching the group', async function () {
    const result = await updateUser({ name: 'listener', password: 'new-hash' }, database);
    const user = await database('t_user').where('name', 'listener').first();

    expect(result.groupChanged).to.equal(false);
    expect(result.passwordChanged).to.equal(true);
    expect(user.group).to.equal('user');
    expect(user.password).to.equal('new-hash');
  });

  it('changes the group and password together', async function () {
    const result = await updateUser({
      name: 'listener',
      group: 'administrator',
      password: 'new-hash'
    }, database);
    const user = await database('t_user').where('name', 'listener').first();

    expect(result.groupChanged).to.equal(true);
    expect(result.passwordChanged).to.equal(true);
    expect(user.group).to.equal('administrator');
    expect(user.password).to.equal('new-hash');
  });

  it('keeps the built-in admin in the administrator group', async function () {
    let error;
    try {
      await updateUser({ name: 'admin', group: 'user' }, database);
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an('error');
    expect(error.status).to.equal(403);
    const user = await database('t_user').where('name', 'admin').first();
    expect(user.group).to.equal('administrator');
  });

  it('does not demote the last enabled administrator', async function () {
    await database('t_user').whereIn('name', ['admin-b', 'admin']).del();

    let error;
    try {
      await updateUser({ name: 'admin-a', group: 'user' }, database);
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an('error');
    expect(error.status).to.equal(403);
    const user = await database('t_user').where('name', 'admin-a').first();
    expect(user.group).to.equal('administrator');
  });
});
