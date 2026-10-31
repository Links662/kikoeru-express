const fs = require('fs');
const path = require('path');
const { config } = require('../config');

const databaseExist = fs.existsSync(path.join(config.databaseFolderDir, 'db.sqlite3'));

const connEnv = 'development';
const conn = require('./knexfile')[connEnv]
const knex = require('knex')(conn);

/**
 * 给作品查询附加年龄分级和字幕筛选。
 * nsfw / subtitle 为 undefined 时表示不筛选。
 */
const applyWorkFilters = (query, { nsfw, subtitle } = {}) => {
  if (typeof nsfw === 'boolean') {
    query.where('nsfw', nsfw)
  }

  if (typeof subtitle === 'boolean') {
    query.where('subtitle', subtitle)
  }

  return query
}

/**
 * 给 Error 挂上 HTTP 状态码，路由层直接用它决定响应码，
 * 不用再靠匹配错误文案来判断是哪种失败。
 */
const httpError = (status, message) => Object.assign(new Error(message), { status });

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
      subtitle: Boolean(work.subtitle),
      release: work.release,

      dl_count: work.dl_count || 0,
      price: work.price || 0,
      review_count: work.review_count || 0,
      rate_count: work.rate_count || 0,
      rate_average_2dp: work.rate_average_2dp || 0,
      rate_count_detail: JSON.stringify(work.rate_count_detail || []),
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
 * 在现有事务内应用作品元数据更新。
 * @param {Object} trx Knex transaction.
 * @param {Object} work Work object.
 * @param {Object} options Update options.
 */
const applyWorkMetadataUpdate = async (trx, work, options = {}) => {
  const dynamicUpdate = {};
  if (work.dl_count !== undefined) dynamicUpdate.dl_count = work.dl_count;
  if (work.price !== undefined) dynamicUpdate.price = work.price;
  if (work.review_count !== undefined) dynamicUpdate.review_count = work.review_count;
  if (work.rate_count !== undefined) dynamicUpdate.rate_count = work.rate_count;
  if (work.rate_average_2dp !== undefined) dynamicUpdate.rate_average_2dp = work.rate_average_2dp;
  if (work.rate_count_detail !== undefined) {
    dynamicUpdate.rate_count_detail = JSON.stringify(work.rate_count_detail || []);
  }
  if (work.rank !== undefined) {
    dynamicUpdate.rank = work.rank ? JSON.stringify(work.rank) : null;
  }

  if (Object.keys(dynamicUpdate).length) {
    await trx('t_work')
      .where('id', '=', work.id)
      .update(dynamicUpdate);
  }

  if (options.includeVA || options.refreshAll) {
    await trx('r_va_work').where('work_id', work.id).del();
    for (const va of work.vas) {
      await trx.raw('INSERT OR IGNORE INTO t_va(id, name) VALUES (?, ?)', [va.id, va.name]);
      await trx.raw('INSERT OR IGNORE INTO r_va_work(va_id, work_id) VALUES (?, ?)', [va.id, work.id]);
    }
  }
  if (options.includeTags || options.refreshAll) {
    // Rebuild the work's tag list from the current scrape.
    await trx('r_tag_work').where('work_id', work.id).del();
    for (const tag of work.tags) {
      await trx.raw('INSERT OR IGNORE INTO t_tag(id, name) VALUES (?, ?)', [tag.id, tag.name]);
      await trx('t_tag')
        .where('id', '=', tag.id)
        .andWhere('name', '<>', tag.name)
        .update({ name: tag.name });
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
    const workUpdate = {
      nsfw: work.nsfw,
      title: work.title,
      release: work.release,
    };

    if (work.circle && work.circle.id !== undefined && work.circle.id !== null && work.circle.name) {
      await trx.raw('INSERT OR IGNORE INTO t_circle(id, name) VALUES (?, ?)', [
        work.circle.id,
        work.circle.name
      ]);
      await trx('t_circle')
        .where('id', '=', work.circle.id)
        .update({ name: work.circle.name });
      workUpdate.circle_id = work.circle.id;
    }

    await trx('t_work')
      .where('id', '=', work.id)
      .update(workUpdate);
  }
};

/**
 * 更新音声的动态元数据。
 * @param {Object} work Work object.
 */
const updateWorkMetadata = (work, options = {}) => knex.transaction(
  trx => applyWorkMetadataUpdate(trx, work, options)
);

const updateWorkSubtitle = (id, subtitle) => knex('t_work')
  .where('id', '=', id)
  .update({
    subtitle: Boolean(subtitle)
  });


/**
 * Fetches metadata for a specific work id.
 * @param {Number} id Work identifier.
 * @param {String} username 'admin' or other usernames for current user
 */
const getWorkMetadata = async (id, username) => {
  // TODO: do this all in a single transaction?

    const ratingSubQuery = knex('t_review')
    .select(['t_review.work_id', 't_review.rating', 't_review.review_text AS reviewText', 't_review.progress', knex.raw('strftime(\'%Y-%m-%d %H:%M:%S\', t_review.updated_at, \'localtime\') AS updatedAt'), 't_review.user_name'])
    .join('t_work', 't_work.id', 't_review.work_id')
    .where('t_review.user_name', username).as('userrate');

    let query = () => knex('staticMetadata')
      .select(['staticMetadata.*', 'userrate.rating', 'userrate.reviewText', 'userrate.progress', 'userrate.updatedAt', 'userrate.user_name'])
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
    await trx('t_history').del().where('work_id', '=', id);
    await trx('t_work').del().where('id', '=', id);
    await cleanupOrphans(
      trxProvider,
      circle.circle_id,
      tags.map(tag => tag.tag_id),
      vas.map(va => va.va_id),
    )
};

/**
 * 给作品查询附加社团、标签、声优和关键词条件。
 * 不同类别之间是 AND；同一类别中的多个 ID 是 OR。
 * 标签和声优使用关联子查询，避免多个 JOIN 产生重复作品。
 */
const applyWorkConditions = (query, {
  circleIds = [],
  tagIds = [],
  vaIds = [],
  keyword = ''
} = {}) => {
  if (circleIds.length) {
    query.whereIn('staticMetadata.circle_id', circleIds);
  }

  if (tagIds.length) {
    query.whereExists(function () {
      this.select(1)
        .from('r_tag_work')
        .whereRaw('r_tag_work.work_id = staticMetadata.id')
        .whereIn('r_tag_work.tag_id', tagIds);
    });
  }

  if (vaIds.length) {
    query.whereExists(function () {
      this.select(1)
        .from('r_va_work')
        .whereRaw('r_va_work.work_id = staticMetadata.id')
        .whereIn('r_va_work.va_id', vaIds);
    });
  }

  const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';
  if (!normalizedKeyword) return query;

  const workIdMatch = normalizedKeyword.match(/((R|r)(J|j))?(\d+)/);
  if (workIdMatch) {
    return query.where('staticMetadata.id', '=', workIdMatch[4]);
  }

  const pattern = `%${normalizedKeyword}%`;
  return query.where(function () {
    this.where('staticMetadata.title', 'like', pattern)
      .orWhereExists(function () {
        this.select(1)
          .from('t_circle')
          .whereRaw('t_circle.id = staticMetadata.circle_id')
          .andWhere('t_circle.name', 'like', pattern);
      })
      .orWhereExists(function () {
        this.select(1)
          .from('r_tag_work')
          .join('t_tag', 't_tag.id', 'r_tag_work.tag_id')
          .whereRaw('r_tag_work.work_id = staticMetadata.id')
          .andWhere('t_tag.name', 'like', pattern);
      })
      .orWhereExists(function () {
        this.select(1)
          .from('r_va_work')
          .join('t_va', 't_va.id', 'r_va_work.va_id')
          .whereRaw('r_va_work.work_id = staticMetadata.id')
          .andWhere('t_va.name', 'like', pattern);
      });
  });
};

/**
 * Returns list of works matching all provided condition groups.
 * @param {Array} circleIds Circle IDs. Multiple values are ORed.
 * @param {Array} tagIds Tag IDs. Multiple values are ORed.
 * @param {Array} vaIds VA IDs. Multiple values are ORed.
 * @param {String} keyword Free-text keyword.
 * @param {String} username Include this user's rating, progress and note.
 */
const getWorksByConditions = ({
  circleIds = [],
  tagIds = [],
  vaIds = [],
  keyword = '',
  username,
  nsfw,
  subtitle
} = {}) => {
  let baseQuery = knex('staticMetadata').select('staticMetadata.*');

  if (username) {
    const userrate = knex('t_review')
      .select([
        'work_id',
        'rating',
        'review_text AS reviewText',
        'progress',
        knex.raw("strftime('%Y-%m-%d %H:%M:%S', updated_at, 'localtime') AS updatedAt")
      ])
      .where('user_name', username)
      .as('userrate');

    baseQuery = baseQuery
      .leftJoin(userrate, 'userrate.work_id', 'staticMetadata.id')
      .select([
        'userrate.rating',
        'userrate.reviewText',
        'userrate.progress',
        'userrate.updatedAt'
      ]);
  }

  baseQuery = applyWorkFilters(baseQuery, { nsfw, subtitle });
  return applyWorkConditions(baseQuery, { circleIds, tagIds, vaIds, keyword });
};

/**
 * Resolve display names for selected filter IDs without loading every label.
 */
const getWorkConditionLabels = async ({ circleIds = [], tagIds = [], vaIds = [] } = {}) => {
  const [circles, tags, vas] = await Promise.all([
    circleIds.length
      ? knex('t_circle').select('id', 'name').whereIn('id', circleIds).orderBy('name')
      : [],
    tagIds.length
      ? knex('t_tag').select('id', 'name').whereIn('id', tagIds).orderBy('name')
      : [],
    vaIds.length
      ? knex('t_va').select('id', 'name').whereIn('id', vaIds).orderBy('name')
      : []
  ]);

  return { circles, tags, vas };
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

const labelListSortFields = new Set(['favourite', 'name', 'count']);

/**
 * 分页获取社团、标签或声优列表。
 * 搜索和排序都在数据库完成，只返回当前页需要的数据。
 */
const getLabelsPage = async ({
  field,
  username,
  keyword = '',
  sortBy = 'favourite',
  sort = 'desc',
  page = 1,
  pageSize = 50,
  database = knex
} = {}) => {
  const validFields = ['circle', 'tag', 'va'];
  if (!validFields.includes(field)) throw new Error('无效的查询域');

  const orderField = labelListSortFields.has(sortBy) ? sortBy : 'favourite';
  const order = sort === 'asc' ? 'asc' : 'desc';
  const normalizedKeyword = typeof keyword === 'string' ? keyword.trim() : '';

  let query;
  if (field === 'circle') {
    query = database('t_work as w')
      .join('t_circle as item', 'w.circle_id', 'item.id')
      .select('item.id', 'item.name')
      .count('w.circle_id as count')
      .groupBy('item.id', 'item.name');
  } else {
    query = database(`r_${field}_work as relation`)
      .join(`t_${field} as item`, `relation.${field}_id`, 'item.id')
      .select('item.id', 'item.name')
      .count(`relation.${field}_id as count`)
      .groupBy('item.id', 'item.name');
  }

  query = query.select(
    database.raw(
      `CASE WHEN EXISTS (
        SELECT 1
        FROM t_favourite AS favourite
        WHERE favourite.user_name = ?
          AND favourite.field = ?
          AND favourite.item_id = CAST(item.id AS TEXT)
      ) THEN 1 ELSE 0 END AS favourite`,
      [username, field]
    )
  );

  if (normalizedKeyword) {
    query.where('item.name', 'like', `%${normalizedKeyword}%`);
  }

  const countResult = await database
    .from(query.clone().as('labels'))
    .count({ count: '*' });
  const totalCount = Number(countResult[0].count) || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const offset = (currentPage - 1) * pageSize;

  const items = await database
    .from(query.as('labels'))
    .select('*')
    .orderBy(orderField, order)
    .orderBy('name', 'asc')
    .orderBy('id', 'asc')
    .limit(pageSize)
    .offset(offset);

  return { items, totalCount, currentPage };
};

/**
 * 获取每个社团/标签/声优最近发售的若干作品 id（列表页展示 RJ 号用）
 * @param {String} field ['circle', 'tag', 'va'] 中的一个
 * @param {Number} limit 每个条目最多取多少条
 * @param {Array<String|Number>} itemIds 可选，仅查询这些条目
 * @returns {Promise<Map<String, Number[]>>} 键为条目 id（字符串），值为作品 id 数组，按发售日倒序
 */
const getRecentWorkIds = async (field = 'circle', limit = 10, itemIds) => {
  const validFields = ['circle', 'tag', 'va'];
  if (!validFields.includes(field)) throw new Error('无效的查询域');
  if (Array.isArray(itemIds) && itemIds.length === 0) return new Map();

  // 社团直接挂在 t_work 上，标签/声优需要走关系表
  const itemColumn = field === 'circle' ? 'w.circle_id' : `r.${field}_id`;
  const workSource = field === 'circle'
    ? 't_work w'
    : `t_work w JOIN r_${field}_work r ON r.work_id = w.id`;
  const itemFilter = Array.isArray(itemIds)
    ? `AND item_id IN (${itemIds.map(() => '?').join(', ')})`
    : '';

  const rows = await knex.raw(`
    WITH ranked AS (
      SELECT ${itemColumn} AS item_id, w.id AS work_id,
             ROW_NUMBER() OVER (PARTITION BY ${itemColumn} ORDER BY w.release DESC, w.id DESC) AS rn
      FROM ${workSource}
    )
    SELECT item_id, work_id
    FROM ranked
    WHERE rn <= ? ${itemFilter}
    ORDER BY item_id, rn
  `, [limit, ...(Array.isArray(itemIds) ? itemIds : [])]);

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
      throw httpError(403, `用户 ${user.name} 已存在.`);
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
      throw httpError(403, '用户名错误.');
    }
    return trx('t_user')
      .where('name', '=', user.name)
      .update({
        password: newPassword
      });
  }));

/**
 * 读取账号状态（不含密码哈希），用于鉴权中间件判断账号是否仍然可用
 * @param {String} name 用户名
 * @returns {Promise<Object|undefined>} { name, group, disabled }
 */
const getUserState = name => knex('t_user')
  .select('name', 'group', 'disabled')
  .where('name', '=', name)
  .first();

/**
 * 统计仍然启用的管理员数量
 * @param {Object} trx 可选的 knex 事务对象，默认走连接池
 */
const countEnabledAdministrators = (trx = knex) => trx('t_user')
  .where('group', '=', 'administrator')
  .andWhere('disabled', '=', 0)
  .count('* as count')
  .first()
  .then(res => Number(res.count));

/**
 * 启用 / 禁用账号。禁用后该账号不能登录，已签发的 token 也会立刻失效
 * （见 api.js 里的账号状态校验），但不会删除它的评语、收藏和历史记录。
 *
 * 内置的 admin 账号同样可以禁用，这是它唯一的“下线”方式 —— 删除接口会拒绝
 * 删除 admin。为避免把管理后台彻底锁死，这里始终要求至少留一个已启用的管理员。
 *
 * @param {String} name 用户名
 * @param {Boolean} disabled true 表示禁用
 */
const setUserDisabled = (name, disabled) => knex.transaction(async (trx) => {
  const user = await trx('t_user').select('name', 'group', 'disabled').where('name', '=', name).first();
  if (!user) {
    throw httpError(404, `用户 ${name} 不存在.`);
  }

  if (disabled && user.group === 'administrator' && user.disabled !== 1) {
    const enabledAdministrators = await countEnabledAdministrators(trx);
    if (enabledAdministrators <= 1) {
      throw httpError(403, '至少要保留一个已启用的管理员账号，不能禁用最后一个管理员.');
    }
  }

  const nextDisabled = disabled ? 1 : 0;
  if (user.disabled === nextDisabled) {
    return { name: user.name, disabled: nextDisabled, changed: false };
  }

  await trx('t_user').where('name', '=', user.name).update({ disabled: nextDisabled });

  return { name: user.name, disabled: nextDisabled, changed: true };
});

/**
 * 删除用户
 *
 * 两条限制：内置的 admin 账号不允许删除（要下线它请用「禁用」），
 * 删除后必须至少留下一个已启用的管理员账号，避免管理后台无人能进。
 *
 * 删除会级联清掉该账号的评语 / 收藏 / 历史记录（外键 ON DELETE CASCADE）。
 *
 * @param {String[]} names 用户名列表
 */
const deleteUser = names => knex.transaction(async (trx) => {
  const uniqueNames = [...new Set(names)];

  if (uniqueNames.includes('admin')) {
    throw httpError(403, '不能删除内置的管理员账号，如需停用它请使用「禁用」.');
  }

  const users = await trx('t_user').select('name', 'group', 'disabled').whereIn('name', uniqueNames);
  if (users.length === 0) {
    throw httpError(404, '选中的账号不存在.');
  }

  const removedEnabledAdministrators = users
    .filter(user => user.group === 'administrator' && user.disabled !== 1)
    .length;

  if (removedEnabledAdministrators > 0) {
    const enabledAdministrators = await countEnabledAdministrators(trx);
    if (enabledAdministrators - removedEnabledAdministrators < 1) {
      throw httpError(403, '至少要保留一个已启用的管理员账号.');
    }
  }

  await trx('t_user').whereIn('name', uniqueNames).del();

  return { deleted: users.map(user => user.name) };
});


const updateUserReview = async (username, workid, rating, reviewText = '', progress = '', starOnly = true, progressOnly= false) => knex.transaction(async(trx) => {
    if (starOnly) {
      await trx.raw('UPDATE t_review SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [rating, username, workid]);
      await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, rating) VALUES (?, ?, ?);', [username, workid, rating]);
    } else if (progressOnly) {
      await trx.raw('UPDATE t_review SET progress = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [progress, username, workid]);
      await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, progress) VALUES (?, ?, ?);', [username, workid, progress]);
    } else {
      await trx.raw('UPDATE t_review SET rating = ?, review_text = ?, progress = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [rating, reviewText, progress, username, workid]);
      await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, rating, review_text, progress) VALUES (?, ?, ?, ?, ?);', [username, workid, rating, reviewText, progress]);
    }

    return trx('t_review')
      .select([
        'rating',
        'review_text AS reviewText',
        'progress',
        trx.raw("strftime('%Y-%m-%d %H:%M:%S', updated_at, 'localtime') AS updatedAt")
      ])
      .where({ user_name: username, work_id: workid })
      .first();
});

const deleteUserReview = (username, workid) => knex.transaction(trx => trx('t_review')
  .where('user_name', '=', username)
  .andWhere('work_id', '=', workid)
  .del());

const getWorksWithReviews = async ({username = '', limit = 1000, offset = 0, orderBy = 'release', sortOption = 'desc', filter} = {}) => {
  let works = [];
  const ratingSubQuery = () => knex('t_review')
    .select([
      'work_id',
      'rating',
      'review_text AS reviewText',
      'progress',
      knex.raw(
        "strftime('%Y-%m-%d %H:%M:%S', updated_at, 'localtime') AS updatedAt"
      ),
      'user_name'
    ])
    .where('user_name', username)
    .as('userrate');

  const baseQuery = () => knex('staticMetadata')
    .select([
      'staticMetadata.*',
      'userrate.rating',
      'userrate.reviewText',
      'userrate.progress',
      'userrate.updatedAt',
      'userrate.user_name'
    ])
    .join(ratingSubQuery(), 'userrate.work_id', 'staticMetadata.id')
    .modify(qb => {
      if (filter) {
        qb.where('userrate.progress', filter);
      }
    });

  const totalCountQuery = baseQuery()
    .clearSelect()
    .count({ count: 'staticMetadata.id' });
  const totalCountResult = await totalCountQuery;
  const totalCount = Number(totalCountResult[0].count) || 0;

  works = await baseQuery()
    .orderBy(orderBy, sortOption)
    .limit(limit)
    .offset(offset);
  return { works, totalCount };
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

const historySelectColumns = [
  'h.user_name',
  'h.work_id',
  'h.file_index',
  'h.file_name',
  'h.play_time',
  'h.total_time',
  'h.updated_at',
  'w.nsfw'
];

const getHistoryByWorkId = async (username, work_id, file_index, database = knex) => {
  return database('t_history as h')
    .join('t_work as w', 'w.id', 'h.work_id')
    .select([
      ...historySelectColumns
    ])
    .where({
      'h.user_name': username,
      'h.work_id': work_id,
      'h.file_index': file_index
    })
    .first(); // 因为主键唯一，所以一定只有一条记录
}

const getHistoryGroupByWorkId = async (username, limit = 100, database = knex) => {
  return database('t_history as h')
    .join('t_work as w', 'w.id', 'h.work_id')
    .select([...historySelectColumns])
    .where('h.user_name', username)
    .orderBy('h.updated_at', 'desc')
    .limit(limit);
}

const deleteHistoryByUserName = async (username) => knex.transaction(async(trx) => {
  await trx.raw(`DELETE FROM t_history WHERE user_name = ?`, [username])
  return
})

module.exports = {
  knex, applyWorkFilters, applyWorkConditions, insertWorkMetadata, getWorkMetadata, removeWork,
  getWorksByConditions, getWorkConditionLabels,
  applyWorkMetadataUpdate, updateWorkMetadata,
  updateWorkSubtitle,
  getLabels, getLabelsPage, getMetadata, getFavourites, setFavourite,
  getRecentWorkIds,
  createUser, updateUserPassword, deleteUser,
  getUserState, setUserDisabled,
  getWorksWithReviews, updateUserReview, deleteUserReview,
  insertHistory, getHistoryByWorkId, getHistoryGroupByWorkId,deleteHistoryByUserName,
  databaseExist
};
