const path = require('path');
const express = require('express');
const router = express.Router();
const { param, query, body} = require('express-validator');
const db = require('../database/db');
const { getTrackList, toTree, coverFilePath, isUsableCoverFile } = require('../filesystem/utils');
const { config, getPageSize } = require('../config');
const normalize = require('./utils/normalize')
const { isValidRequest } = require('./utils/validate');

// express 5 的 path-to-regexp v8 不再支持 '/:field(circle|tag|va)s/:id' 这类正则参数，
// 也不再支持 '/search/:keyword?' 这类可选参数，因此改成通用参数 + 校验：
// mapFieldParam 负责把 circles/tags/vas 归一化成 req.params.field，
// 非法值用 next('route') 跳过（等价于旧写法里正则不匹配时交给后续路由处理）。
const FIELD_PARAMS = { circles: 'circle', tags: 'tag', vas: 'va' };
const FIELD_PARAM_VALUES = Object.keys(FIELD_PARAMS);

const mapFieldParam = (req, res, next) => {
  const field = FIELD_PARAMS[req.params.fields];
  if (!field) return next('route');
  req.params.field = field;
  return next();
};


// 封面类型：main（必需，560x420 原图）、sam / 240x240（两张缩略图）。
// sam@2x / sam@3x 是 sam 的高分变体，360x360 已废弃，都由这里兼容到现有类型。
const LEGACY_COVER_TYPE_MAP = {
  'sam@2x': 'sam',
  'sam@3x': 'sam',
  '360x360': '240x240'
};
// 请求的类型缺失时按这里的顺序降级，最后退回占位图。
// 小图缺失时前端拿到的会是更大的一张（由 CSS 缩放、必要时留白显示），而不是破图。
const COVER_TYPE_FALLBACK = {
  'main': [],
  'sam': ['240x240', 'main'],
  '240x240': ['main']
};
const NO_IMAGE_PATH = path.join(__dirname, '../static/no-image.jpg');

router.get('/cover/:id',
  param('id').isInt({ min: 1 }),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    const requestedType = String(req.query.type || 'main');
    const type = LEGACY_COVER_TYPE_MAP[requestedType] || requestedType;
    // 白名单：未知类型（包括用来拼路径的恶意片段）一律按 main 处理
    const candidates = Object.prototype.hasOwnProperty.call(COVER_TYPE_FALLBACK, type)
      ? [type].concat(COVER_TYPE_FALLBACK[type])
      : ['main'];
    const filePaths = [...new Set(candidates)].map(candidate => coverFilePath(req.params.id, candidate));

    const sendFallback = (index) => {
      if (index >= filePaths.length) {
        return res.sendFile(NO_IMAGE_PATH, (err) => {
          if (err && !res.headersSent) next(err);
        });
      }

      // 0 字节 / 截断的封面（下载中断留下的）视为缺失，继续降级
      if (!isUsableCoverFile(filePaths[index])) return sendFallback(index + 1);

      res.sendFile(filePaths[index], (err) => {
        if (err && !res.headersSent) sendFallback(index + 1);
      });
    };

    sendFallback(0);
});

router.get('/work/:id',
  param('id').isInt(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    let username = 'admin';
    if (config.auth) {
      username = req.user.name;
    }
    db.getWorkMetadata(req.params.id, username)
      .then(work => {
        // work is an Array of length 1
        normalize(work);
        res.send(work[0]);
      })
      .catch(err => next(err));
  });

router.get('/tracks/:id',
  param('id').isInt(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    db.knex('t_work')
      .select('title', 'root_folder', 'dir')
      .where('id', '=', req.params.id)
      .first()
      .then((work) => {
        const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === work.root_folder);
        if (rootFolder) {
          getTrackList(req.params.id, path.join(rootFolder.path, work.dir))
            .then(tracks => res.send(toTree(tracks, work.dir, rootFolder)))
            .catch(() => res.status(500).send({error: '获取文件列表失败，请检查文件是否存在或重新扫描清理'}));
        } else {
          res.status(500).send({error: `找不到文件夹: "${work.root_folder}"，请尝试重启服务器或重新扫描.`});
        }
      })
      .catch(err => next(err));
});

router.get('/works',
  query('page').optional({ nullable: true }).isInt(),
  query('sort').optional({ nullable: true }).isIn(['desc', 'asc']),
  query('seed').optional({ nullable: true }).isInt(),
  async (req, res) => {
    if (!isValidRequest(req, res)) return;

    const currentPage = parseInt(req.query.page) || 1;
    const order = req.query.order || 'release';
    const sort = req.query.sort || 'desc';
    const offset = (currentPage - 1) * getPageSize();
    const shuffleSeed = req.query.seed ? req.query.seed : 7;
    const username = config.auth ? req.user.name : 'admin';

    try {
      const baseQuery = () => db.getWorksBy({ username });
      const totalCount = await db.getWorksCount(1)
      let works;

      if (order === 'random') {
        // 随机排序 + 分页 hack（用 modulo 避免全表扫描）
        works = await baseQuery()
          .offset(offset)
          .limit(getPageSize())
          .orderBy(db.knex.raw('id % ?', shuffleSeed));
      } else if (order === 'betterRandom') {
        // 随心听专用，不支持分页
        works = await baseQuery()
          .limit(1)
          .orderBy(db.knex.raw('random()'));
      } else {
        // 普通排序，带索引
        works = await baseQuery()
          .offset(offset)
          .limit(getPageSize())
          .orderBy(order, sort)
          .orderBy([{ column: 'release', order: 'desc' }, { column: 'id', order: 'desc' }]);
      }

      works = normalize(works);

      res.send({
        works,
        pagination: {
          currentPage,
          pageSize: getPageSize(),
          totalCount
        }
      });

    } catch (err) {
      console.error(err);
      res.status(500).send({ error: '服务器错误' });
    }
  });


router.get('/:fields/:id',
  mapFieldParam,
  param('fields').isIn(FIELD_PARAM_VALUES),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    return db.getMetadata({field: req.params.field, id: req.params.id})
      .then(item => {
        if (item) {
          res.send(item) 
        } else {
          const errorMessage= {
            'circle': `社团${req.params.id}不存在`,
            'tag': `标签${req.params.id}不存在`,
            'va': `声优${req.params.id}不存在`
          }
          res.status(404).send({error: errorMessage[req.params.field]})
        }
      })
      .catch(err => next(err));
});

router.put('/:fields/:id/favourite',
  mapFieldParam,
  param('fields').isIn(FIELD_PARAM_VALUES),
  body('favourite').isBoolean(),
  (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    const notExistMessage = {
      'circle': `社团${req.params.id}不存在`,
      'tag': `标签${req.params.id}不存在`,
      'va': `声优${req.params.id}不存在`
    }

    db.setFavourite({
      username: config.auth ? req.user.name : 'admin',
      field: req.params.field,
      id: req.params.id,
      favourite: req.body.favourite
    })
      .then(exists => {
        if (!exists) {
          res.status(404).send({error: notExistMessage[req.params.field]})
        } else {
          res.send({message: req.body.favourite ? '已收藏' : '已取消收藏'})
        }
      })
      .catch(err => next(err));
});

// eslint-disable-next-line no-unused-vars
const searchWorks = async (req, res, next) => {
  const keyword = req.params.keyword ? req.params.keyword.trim() : '';
  const currentPage = parseInt(req.query.page) || 1;
  const order = req.query.order || 'release';
  const sort = req.query.sort || 'desc';
  const offset = (currentPage - 1) * getPageSize();
  const username = config.auth ? req.user.name : 'admin';
  const shuffleSeed = req.query.seed ? req.query.seed : 7;
  
  try {
    const query = () => db.getWorksByKeyWord({keyword: keyword, username: username});
    const totalCount = await query().count('id as count');

    let works = null;

    if (order === 'random') {
      works = await query().offset(offset).limit(getPageSize()).orderBy(db.knex.raw('id % ?', shuffleSeed));
    } else {
      works = await query().offset(offset).limit(getPageSize()).orderBy(order, sort)
        .orderBy([{ column: 'release', order: 'desc'}, { column: 'id', order: 'desc' }])
    }

    works = normalize(works);

    res.send({
      works,
      pagination: {
        currentPage,
        pageSize: getPageSize(),
        totalCount: totalCount[0]['count']
      }
    });
  } catch(err) {
    res.status(500).send({error: '查询过程中出错'});
    console.error(err);
  }
};

// express 5 不支持 '/search/:keyword?' 这种可选参数，拆成带/不带关键字两条路由
router.get('/search', searchWorks);
router.get('/search/:keyword', searchWorks);

router.get('/:fields/:id/works',
  mapFieldParam,
  param('fields').isIn(FIELD_PARAM_VALUES),
  // eslint-disable-next-line no-unused-vars
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    const currentPage = parseInt(req.query.page) || 1;
    const order = req.query.order || 'release';
    const sort = req.query.sort || 'desc';
    const offset = (currentPage - 1) * getPageSize();
    const shuffleSeed = req.query.seed ? req.query.seed : 7;
    const username = config.auth ? req.user.name : 'admin';

    try {
      const query = () => db.getWorksBy({
        id: req.params.id,
        field: req.params.field,
        username
      });
      const totalCount = await query().count('id as count');

      let works = null;

      if (order === 'random') {
        works = await query().offset(offset).limit(getPageSize()).orderBy(db.knex.raw('id % ?', shuffleSeed));
      } else {
        works = await query().offset(offset).limit(getPageSize()).orderBy(order, sort)
        .orderBy([{ column: 'release', order: 'desc'}, { column: 'id', order: 'desc' }])
      }

      works = normalize(works);

      res.send({
        works,
        pagination: {
          currentPage,
          pageSize: getPageSize(),
          totalCount: totalCount[0]['count']
        }
      });
    } catch(err) {
      res.status(500).send({error: '查询过程中出错'});
      console.error(err);
    }
});

router.get('/:fields',
  mapFieldParam,
  param('fields').isIn(FIELD_PARAM_VALUES),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    const field = req.params.field;
    const username = config.auth ? req.user.name : 'admin';

    try {
      const [list, favourites, recentWorks] = await Promise.all([
        db.getLabels(field).orderBy(`name`, 'asc'),
        db.getFavourites(username, field),
        db.getRecentWorkIds(field, 10)
      ]);
      const favouriteIds = new Set(favourites.map(item => String(item.item_id)));
      list.forEach(item => {
        item.favourite = favouriteIds.has(String(item.id)) ? 1 : 0;
        // 列表页展示最近发售的 RJ 号
        item.recentWorks = recentWorks.get(String(item.id)) || [];
      });
      res.send(list);
    } catch (err) {
      next(err);
    }
});

module.exports = router;
