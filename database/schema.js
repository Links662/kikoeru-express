const { knex } = require('./db');

const dbVersion = '20260117';

// 1. 创建核心业务表
const createCoreTables = async () => {
  const exists = await knex.schema.hasTable('t_circle');
  if (exists) {
    console.log(' * 核心数据库表已存在，跳过创建.');
    return;
  }

  await knex.schema
    .createTable('t_circle', (table) => {
      table.increments();
      table.string('name').notNullable();
    })
    .createTable('t_work', (table) => {
      table.increments();
      table.string('root_folder').notNullable();
      table.string('dir').notNullable();
      table.string('title').notNullable();
      table.integer('circle_id').notNullable();
      table.boolean('nsfw');
      table.string('release');
      table.integer('dl_count');
      table.integer('price');
      table.integer('review_count');
      table.integer('rate_count');
      table.float('rate_average_2dp');
      table.text('rate_count_detail');
      table.text('rank');
      table.timestamp('insert_time').defaultTo(knex.fn.now()); // 补全视图中引用的字段
      table.foreign('circle_id').references('id').inTable('t_circle');
      table.index(['circle_id', 'release', 'dl_count', 'review_count', 'price', 'rate_average_2dp'], 't_work_index');
    })
    .createTable('t_tag', (table) => {
      table.increments();
      table.string('name').notNullable();
    })
    .createTable('t_va', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
    })
    .createTable('r_tag_work', (table) => {
      table.integer('tag_id').references('id').inTable('t_tag');
      table.integer('work_id').references('id').inTable('t_work');
      table.primary(['tag_id', 'work_id']);
      table.index(['work_id', 'tag_id'], 'idx_r_tag_work_work_id');
    })
    .createTable('r_va_work', (table) => {
      table.string('va_id').references('id').inTable('t_va').onUpdate('CASCADE').onDelete('CASCADE');
      table.integer('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
      table.primary(['va_id', 'work_id']);
      table.index(['work_id', 'va_id'], 'idx_r_va_work_work_id');
    })
    .createTable('t_user', (table) => {
      table.string('name').primary();
      table.string('password').notNullable();
      table.string('group').notNullable();
    })
    .createTable('t_review', (table) => {
      table.string('user_name').references('name').inTable('t_user').onDelete('CASCADE');
      table.integer('work_id').references('id').inTable('t_work').onDelete('CASCADE');
      table.integer('rating');
      table.string('review_text');
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.string('progress');
      table.primary(['user_name', 'work_id']);
    });
  
  console.log(' * 成功构建核心数据库结构.');
};

// 2. 创建历史记录表
const createHistoryTable = async () => {
  const exists = await knex.schema.hasTable('t_history');
  if (exists) return;

  await knex.schema.createTable('t_history', (table) => {
    table.increments('id').primary();
    table.string('user_name').notNullable().references('name').inTable('t_user').onDelete('CASCADE');
    table.integer('work_id').notNullable().references('id').inTable('t_work').onDelete('CASCADE');
    table.string('file_index').notNullable();
    table.string('file_name');
    table.integer('play_time');
    table.integer('total_time');
    table.timestamps(true, true);
    table.unique(['user_name', 'work_id', 'file_index']);
  });
  console.log(' * 成功构建历史记录表.');
};

// 3. 创建/更新视图
const createView = async () => {
  await knex.raw('DROP VIEW IF EXISTS staticMetadata');

  const selectQuery = knex('t_work as w')
    .select(
      'w.id', 'w.title', 'w.circle_id', 'c.name',
      knex.raw("json_object('id', w.circle_id, 'name', c.name) AS circleObj"),
      'w.nsfw', 'w.release', 'w.dl_count', 'w.price', 'w.review_count', 'w.rate_count',
      'w.rate_average_2dp', 'w.rate_count_detail', 'w.rank', 'w.insert_time',
      knex.raw(`(
        SELECT json_object('vas', json_group_array(json_object('id', v.id, 'name', v.name)))
        FROM r_va_work rv
        JOIN t_va v ON v.id = rv.va_id
        WHERE rv.work_id = w.id
      ) AS vaObj`),
      knex.raw(`(
        SELECT json_object('tags', json_group_array(json_object('id', t.id, 'name', t.name)))
        FROM r_tag_work rt
        JOIN t_tag t ON t.id = rt.tag_id
        WHERE rt.work_id = w.id
      ) AS tagObj`)
    )
    .join('t_circle as c', 'c.id', 'w.circle_id');

  await knex.raw(`CREATE VIEW staticMetadata AS ${selectQuery.toString()}`);
  console.log(' * 视图 staticMetadata 已同步.');
};

// 4. 总初始化入口
const initDatabase = async () => {
  try {
    console.log(`--- 开始初始化数据库 v${dbVersion} ---`);
    await createCoreTables();
    await createHistoryTable();
    await createView();
    console.log('--- 数据库初始化全部完成 ---');
  } catch (err) {
    console.error(' !!! 数据库初始化失败:', err);
    throw err;
  }
};

module.exports = { initDatabase, dbVersion };