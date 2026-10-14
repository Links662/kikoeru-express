const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const databaseExist = fs.existsSync(path.join(config.databaseFolderDir, 'db.sqlite3'));

const connEnv = 'development';
const conn = require('./knexfile')[connEnv]
const knex = require('knex')(conn);

let cachedTotalCount = null;

/**
 * Takes a work metadata object and inserts it into the database.
 * @param {Object} work Work object.
 */
const insertWorkMetadata = work => knex.transaction(trx => trx.raw(
  trx('t_circle')
    .insert({
      id: work.circle.id,
      name: work.circle.name,
    }).toString().replace('insert', 'insert or ignore'),
)
  .then(() => trx('t_work')
    .insert({
      id: work.id,
      root_folder: work.rootFolderName,
      dir: work.dir,
      title: work.title,
      circle_id: work.circle.id,
      nsfw: work.nsfw,
      release: work.release,

      dl_count: work.dl_count,
      price: work.price,
      review_count: work.review_count,
      rate_count: work.rate_count,
      rate_average_2dp: work.rate_average_2dp,
      rate_count_detail: JSON.stringify(work.rate_count_detail),
      rank: work.rank ? JSON.stringify(work.rank) : null,

      insert_time: knex.fn.now()
    }))
  .then(() => {
    const promises = [];

    for (let i = 0; i < work.tags.length; i += 1) {
      promises.push(trx.raw(
        trx('t_tag')
          .insert({
            id: work.tags[i].id,
            name: work.tags[i].name,
          }).toString().replace('insert', 'insert or ignore'),
      )
        .then(() => trx('r_tag_work')
          .insert({
            tag_id: work.tags[i].id,
            work_id: work.id,
          })));
    }

    for (let i = 0; i < work.vas.length; i += 1) {
      promises.push(trx.raw(
        trx('t_va')
          .insert({
            id: work.vas[i].id,
            name: work.vas[i].name,
          }).toString().replace('insert', 'insert or ignore'),
      )
        .then(() => trx.raw(
          trx('r_va_work')
            .insert({
              va_id: work.vas[i].id,
              work_id: work.id,
            }).toString().replace('insert', 'insert or ignore'))));
    }

    return Promise.all(promises)
      .then(() => trx);
  }));

/**
 * 更新音声的动态元数据
 * @param {Object} work Work object.
 */
const updateWorkMetadata = (work, options = {}) => knex.transaction(async (trx) => {
  await trx('t_work')
    .where('id', '=', work.id)
    .update({
      dl_count: work.dl_count,
      price: work.price,
      review_count: work.review_count,
      rate_count: work.rate_count,
      rate_average_2dp: work.rate_average_2dp,
      rate_count_detail: JSON.stringify(work.rate_count_detail),
      rank: work.rank ? JSON.stringify(work.rank) : null,
    });

  if (options.includeVA || options.refreshAll) {
    await trx('r_va_work').where('work_id', work.id).del();
    for (const va of work.vas) {
      await trx.raw('INSERT OR IGNORE INTO t_va(id, name) VALUES (?, ?)', [va.id, va.name]);
      await trx.raw('INSERT OR IGNORE INTO r_va_work(va_id, work_id) VALUES (?, ?)', [va.id, work.id]);
    }
  }
  if (options.includeTags || options.refreshAll) {
    if (options.purgeTags) {
      await trx('r_tag_work').where('work_id', work.id).del();
    }
    for (const tag of work.tags) {
      await trx.raw('INSERT OR IGNORE INTO t_tag(id, name) VALUES (?, ?)', [tag.id, tag.name]);
      await trx.raw('INSERT OR IGNORE INTO r_tag_work(tag_id, work_id) VALUES (?, ?)', [tag.id, work.id]);
    }
  }

  // Fix a bug caused by DLsite changes
  if (options.includeNSFW) {
    await trx('t_work')
    .where('id', '=', work.id)
    .update({
      nsfw: work.nsfw
    });
  }

  if (options.refreshAll) {
    await trx('t_work')
    .where('id', '=', work.id)
    .update({
      nsfw: work.nsfw,
      title: work.title,
      release: work.release,
    });
  }
});


/**
 * Fetches metadata for a specific work id.
 * @param {Number} id Work identifier.
 * @param {String} username 'admin' or other usernames for current user
 */
const getWorkMetadata = async (id, username) => {
  // TODO: do this all in a single transaction?

    const ratingSubQuery = knex('t_review')
    .select(['t_review.work_id', 't_review.rating AS userRating', 't_review.review_text', 't_review.progress', knex.raw('strftime(\'%Y-%m-%d %H:%M:%S\', t_review.updated_at, \'localtime\') AS updated_at'), 't_review.user_name'])
    .join('t_work', 't_work.id', 't_review.work_id')
    .where('t_review.user_name', username).as('userrate');

    let query = () => knex('staticMetadata')
      .select(['staticMetadata.*', 'userrate.userRating', 'userrate.review_text', 'userrate.progress', 'userrate.updated_at', 'userrate.user_name'])
      .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
      .where('id', '=', id);

    const work = await query();
    if (work.length === 0) throw new Error(`There is no work with id ${id} in the database.`);
    return work;
};

/**
 * Tests if the given circle, tags and VAs are orphans and if so, removes them.
 * @param {*} trx Knex transaction object.
 * @param {*} circle Circle id to check.
 * @param {*} tags Array of tag ids to check.
 * @param {*} vas Array of VA ids to check.
 */
const cleanupOrphans = async (trxProvider, circle, tags, vas)  => {
  const trx = await trxProvider();
  const getCount = (tableName, colName, colValue) => new Promise((resolveCount, rejectCount) => {
    trx(tableName)
      .select(colName)
      .where(colName, '=', colValue)
      .count()
      .first()
      .then(res => res['count(*)'])
      .then(count => resolveCount(count))
      .catch(err => rejectCount(err));
  });

  const promises = [];
  promises.push(new Promise((resolveCircle, rejectCircle) => {
    getCount('t_work', 'circle_id', circle)
      .then((count) => {
        if (count === 0) {
          trx('t_circle')
            .del()
            .where('id', '=', circle)
            .then(() => resolveCircle())
            .catch(err => rejectCircle(err));
        } else {
          resolveCircle();
        }
      });
  }));

  for (let i = 0; i < tags.length; i += 1) {
    const tag = tags[i];
    const count = await getCount('r_tag_work', 'tag_id', tag);

    if (count === 0) {
      promises.push(
        trx('t_tag')
          .delete()
          .where('id', '=', tag),
      );
    }
  }

  for (let i = 0; i < vas.length; i += 1) {
    const va = vas[i];
    const count = await getCount('r_va_work', 'va_id', va);

    if (count === 0) {
      promises.push(
        trx('t_va')
          .delete()
          .where('id', '=', va),
      );
    }
  }

  await Promise.all(promises);
};

/**
 * Removes a work and then its orphaned circles, tags & VAs from the database.
 * @param {Integer} id Work id.
 */
const removeWork = async (id, trxProvider) => {
  const trx = await trxProvider();
    const circle = await trx('t_work').select('circle_id').where('id', '=', id).first();
    const tags = await trx('r_tag_work').select('tag_id').where('work_id', '=', id);
    const vas = await trx('r_va_work').select('va_id').where('work_id', '=', id);

    await trx('r_tag_work').del().where('work_id', '=', id);
    await trx('r_va_work').del().where('work_id', '=', id);
    await trx('t_review').del().where('work_id', '=', id);
    await trx('t_work').del().where('id', '=', id);
    await cleanupOrphans(
      trxProvider,
      circle.circle_id,
      tags.map(tag => tag.tag_id),
      vas.map(va => va.va_id),
    )
};

/**
 * Returns list of works by circle, tag or VA.
 * @param {Number} id Which id to filter by.
 * @param {String} field Which field to filter by.
 */
const getWorksBy = ({ id, field } = {}) => {
  let baseQuery = knex('staticMetadata').select('staticMetadata.*');

  switch (field) {
    case 'circle':
      return baseQuery.where('circle_id', id);

    case 'tag':
      return baseQuery
        .join('r_tag_work', 'r_tag_work.work_id', 'staticMetadata.id')
        .where('r_tag_work.tag_id', id);

    case 'va':
      return baseQuery
        .join('r_va_work', 'r_va_work.work_id', 'staticMetadata.id')
        .where('r_va_work.va_id', id);

    default:
      return baseQuery;
  }
};

const getWorksCount = async (cacheflag = 0) => {
  if (cacheflag == 1 && cachedTotalCount != null) {
    return cachedTotalCount;
  } else {
    const baseQuery = () => getWorksBy({});
    const totalCountResult = await baseQuery().count('id as count');
    cachedTotalCount = totalCountResult[0].count;
    return cachedTotalCount;
  }
};

/**
 * 根据关键字查询音声
 * @param {String} keyword
 */
const getWorksByKeyWord = ({keyword, username = 'admin'} = {}) => {
  const ratingSubQuery = knex('t_review')
  .select(['t_review.work_id', 't_review.rating'])
  .join('t_work', 't_work.id', 't_review.work_id')
  .where('t_review.user_name', username).as('userrate')

  const workid = keyword.match(/((R|r)(J|j))?(\d+)/) ? keyword.match(/((R|r)(J|j))?(\d+)/)[4] : '';
  if (workid) {
    return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
      .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
      .where('id', '=', workid);
  }

  const circleIdQuery = knex('t_circle').select('id').where('name', 'like', `%${keyword}%`);

  const tagIdQuery = knex('t_tag').select('id').where('name', 'like', `%${keyword}%`);
  const vaIdQuery = knex('t_va').select('id').where('name', 'like', `%${keyword}%`);

  const workIdQuery = knex('r_tag_work').select('work_id').where('tag_id', 'in', tagIdQuery).union([
    knex('r_va_work').select('work_id').where('va_id', 'in', vaIdQuery)
  ]);


  return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
    .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
    .where('title', 'like', `%${keyword}%`)
    .orWhere('circle_id', 'in', circleIdQuery)
    .orWhere('id', 'in', workIdQuery);
};

/**
 * 获取所有社团/标签/声优的元数据列表
 * @param {Starting} field ['circle', 'tag', 'va'] 中的一个
 */
const getLabels = (field) => {
  if (field === 'circle') {
    return knex('t_work')
      .join(`t_${field}`, `${field}_id`, '=', `t_${field}.id`)
      .select(`t_${field}.id`, 'name')
      .groupBy(`${field}_id`)
      .count(`${field}_id as count`);
  } else if (field === 'tag' || field === 'va') {
    return knex(`r_${field}_work`)
      .join(`t_${field}`, `${field}_id`, '=', 'id')
      .select('id', 'name')
      .groupBy(`${field}_id`)
      .count(`${field}_id as count`);
  }
};

/**
 * 获取每个社团/标签/声优最近发售的若干作品 id（列表页展示 RJ 号用）
 * @param {String} field ['circle', 'tag', 'va'] 中的一个
 * @param {Number} limit 每个条目最多取多少条
 * @returns {Promise<Map<String, Number[]>>} 键为条目 id（字符串），值为作品 id 数组，按发售日倒序
 */
const getRecentWorkIds = async (field = 'circle', limit = 10) => {
  const validFields = ['circle', 'tag', 'va'];
  if (!validFields.includes(field)) throw new Error('无效的查询域');

  // 社团直接挂在 t_work 上，标签/声优需要走关系表
  const itemColumn = field === 'circle' ? 'w.circle_id' : `r.${field}_id`;
  const workSource = field === 'circle'
    ? 't_work w'
    : `t_work w JOIN r_${field}_work r ON r.work_id = w.id`;

  const rows = await knex.raw(`
    WITH ranked AS (
      SELECT ${itemColumn} AS item_id, w.id AS work_id,
             ROW_NUMBER() OVER (PARTITION BY ${itemColumn} ORDER BY w.release DESC, w.id DESC) AS rn
      FROM ${workSource}
    )
    SELECT item_id, work_id
    FROM ranked
    WHERE rn <= ?
    ORDER BY item_id, rn
  `, [limit]);

  const result = new Map();
  for (const row of rows) {
    const key = String(row.item_id);
    if (result.has(key) === false) result.set(key, []);
    result.get(key).push(row.work_id);
  }
  return result;
};

/**
 * 创建一个新用户
 * @param {Object} user User object.
 */
const createUser = user => knex.transaction(trx => trx('t_user')
  .where('name', '=', user.name)
  .first()
  .then((res) => {
    if (res) {
      throw new Error(`用户 ${user.name} 已存在.`);
    }
    return trx('t_user')
      .insert(user);
  }));

/**
 * 更新用户密码
 * @param {Object} user User object.
 * @param {String} newPassword new password
 */
const updateUserPassword = (user, newPassword) => knex.transaction(trx => trx('t_user')
  .where('name', '=', user.name)
  .first()
  .then((res) => {
    if (!res) {
      throw new Error('用户名或密码错误.');
    }
    return trx('t_user')
      .where('name', '=', user.name)
      .update({
        password: newPassword
      });
  }));

/**
 * 重置用户密码为 "password"
 * @param {Object} user User object.
 */
const resetUserPassword = (user) => knex.transaction(trx => trx('t_user')
  .where('name', '=', user.name)
  .first()
  .then((res) => {
    if (!res) {
      throw new Error('用户名错误.');
    }
    return trx('t_user')
      .where('name', '=', user.name)
      .update({
        password: 'password'
      });
  }));

/**
 * 删除用户
 * @param {Object} user User object.
 */
const deleteUser = users => knex.transaction(trx => trx('t_user')
  .where('name', 'in', users.map(user => user.name))
  .del());


const updateUserReview = async (username, workid, rating, review_text = '', progress = '', starOnly = true, progressOnly= false) => knex.transaction(async(trx) => {
    if (starOnly) {
      await trx.raw('UPDATE t_review SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [rating, username, workid]);
      await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, rating) VALUES (?, ?, ?);', [username, workid, rating]);
    } else if (progressOnly) {
      await trx.raw('UPDATE t_review SET progress = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [progress, username, workid]);
      await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, progress) VALUES (?, ?, ?);', [username, workid, progress]);
    } else {
      await trx.raw('UPDATE t_review SET rating = ?, review_text = ?, progress = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [rating, review_text, progress, username, workid]);
      await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, rating, review_text, progress) VALUES (?, ?, ?, ?, ?);', [username, workid, rating, review_text, progress]);
    }
});

const deleteUserReview = (username, workid) => knex.transaction(trx => trx('t_review')
  .where('user_name', '=', username)
  .andWhere('work_id', '=', workid)
  .del());

const getWorksWithReviews = async ({username = '', limit = 1000, offset = 0, orderBy = 'release', sortOption = 'desc', filter} = {}) => {
  let works = [];
  const ratingSubQuery = knex('t_review')
    .select([
      'work_id',
      'rating AS userRating',
      'review_text',
      'progress',
      knex.raw(
        "strftime('%Y-%m-%d %H:%M:%S', updated_at, 'localtime') AS updated_at"
      ),
      'user_name'
    ])
    .where('user_name', username)
    .as('userrate');

  const baseQuery = knex('staticMetadata')
    .select([
      'staticMetadata.*',
      'userrate.userRating',
      'userrate.review_text',
      'userrate.progress',
      'userrate.updated_at',
      'userrate.user_name'
    ])
    .join(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
    .modify(qb => {
      if (filter) {
        qb.where('userrate.progress', filter);
      }
    });

  works = await baseQuery
    .orderBy(orderBy, sortOption)
    .limit(limit + 1)
    .offset(offset);
  const hasMore = works.length > limit;
  return { works:works.slice(0, limit), hasMore };
};

const getMetadata = ({field = 'circle', id} = {}) => {
  const validFields = ['circle', 'tag', 'va'];
  if (!validFields.includes(field)) throw new Error('无效的查询域');
  return knex(`t_${field}`)
    .select('*')
    .where('id', '=', id)
    .first()
}

/**
 * 获取某个用户对某类（社团/标签/声优）的收藏
 * @param {String} username 用户名
 * @param {String} field ['circle', 'tag', 'va'] 中的一个
 * @returns {Promise<Array>} [{ item_id }]
 */
const getFavourites = (username, field) => {
  const validFields = ['circle', 'tag', 'va'];
  if (!validFields.includes(field)) throw new Error('无效的查询域');
  return knex('t_favourite')
    .select('item_id')
    .where({ user_name: username, field: field });
}

/**
 * 设置某个用户对社团/标签/声优的收藏状态
 * @param {Object} options
 * @param {String} options.username 用户名
 * @param {String} options.field ['circle', 'tag', 'va'] 中的一个
 * @param {String|Number} options.id 收藏对象的 id
 * @param {Boolean} options.favourite 是否收藏
 * @returns {Promise<Boolean>} 收藏对象是否存在
 */
const setFavourite = async ({username, field = 'circle', id, favourite} = {}) => {
  const validFields = ['circle', 'tag', 'va'];
  if (!validFields.includes(field)) throw new Error('无效的查询域');

  // 对象不存在时不写入收藏，由调用方返回 404
  const target = await knex(`t_${field}`).where('id', '=', id).first();
  if (!target) return false;

  // t_circle/t_tag 的 id 是整数，t_va 的 id 是字符串，统一按字符串存
  const itemId = String(id);

  if (favourite) {
    await knex.raw(
      'INSERT OR IGNORE INTO t_favourite (user_name, field, item_id) VALUES (?, ?, ?)',
      [username, field, itemId]
    );
  } else {
    await knex('t_favourite')
      .where({ user_name: username, field: field, item_id: itemId })
      .del();
  }

  return true;
}

const insertHistory = (username, work_id, file_index, file_name, play_time, total_time) => 
  knex.transaction(async (trx) => {
    await trx.raw(`
      INSERT INTO t_history (user_name, work_id, file_index, file_name, play_time, total_time) 
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (work_id, user_name) 
      DO UPDATE SET 
        file_index = EXCLUDED.file_index,
        file_name = EXCLUDED.file_name,
        play_time = EXCLUDED.play_time,
        total_time = EXCLUDED.total_time,
        updated_at = CURRENT_TIMESTAMP
    `, [username, work_id, file_index, file_name, play_time, total_time]);
  });

const getHistoryByWorkId = async (username, work_id, file_index) => {
  return knex('t_history')
    .select([
      'user_name',
      'work_id',
      'file_index',
      'file_name',
      'play_time',
      'total_time',
      'updated_at'
    ])
    .where({
      user_name: username,
      work_id,
      file_index
    })
    .first(); // 因为主键唯一，所以一定只有一条记录
}

const getHistoryGroupByWorkId = async (username, limit = 100) => {
  return knex('t_history')
    .select('*')
    .where('user_name', username)
    .orderBy('updated_at', 'desc')
    .limit(limit);
}

const deleteHistoryByUserName = async (username) => knex.transaction(async(trx) => {
  await trx.raw(`DELETE FROM t_history WHERE user_name = ?`, [username])
  return
})

module.exports = {
  knex, insertWorkMetadata, getWorkMetadata, removeWork, getWorksBy, getWorksCount, getWorksByKeyWord, updateWorkMetadata,
  getLabels, getMetadata, getFavourites, setFavourite,
  getRecentWorkIds,
  createUser, updateUserPassword, resetUserPassword, deleteUser,
  getWorksWithReviews, updateUserReview, deleteUserReview,
  insertHistory, getHistoryByWorkId, getHistoryGroupByWorkId,deleteHistoryByUserName,
  databaseExist
};
