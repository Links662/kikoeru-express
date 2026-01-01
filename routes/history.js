const express = require('express');
const router = express.Router();
const { config } = require('../config');
const db = require('../database/db');
const { query, body } = require('express-validator');
const { isValidRequest } = require('./utils/validate')


// 历史记录插入和获取的简单实现
// Post add a play history
router.put('/', 
  body('work_id').isInt(),
  body('file_index').isInt(),
  body('file_name').isString(),
  body('play_time'),
  body('total_time'),
  (req, res) => {
    if(!isValidRequest(req, res)) return;

    // 插入历史记录
    const username = config.auth ? req.user.name : 'admin';

    db.insertHistory(username, req.body.work_id, req.body.file_index, req.body.file_name, parseInt(req.body.play_time), parseInt(req.body.total_time))
    .then(() => {
      res.send({ message: '历史记录添加成功' });
    }).catch((err) =>{
      res.status(500).send({ error: '添加失败，服务器错误' });
      console.error(err);
    })
  }  
)

router.get('/getByWorkIdIndex', 
  query('work_id'),
  query('file_index'),
  async (req, res) => {
    if(!isValidRequest(req, res)) return;

    const username = config.auth ? req.user.name : 'admin';

    try {
      let history = await db.getHistoryByWorkIdIndex(username, req.query.work_id, req.query.file_index)

      if (history) {
        history.work_id = Number(history.work_id)
        history.file_index = Number(history.file_index)
      }

      res.send(history)
    } catch(err) {
      console.log(err)
      res.status(500).send({ error: '服务器错误' });
    }

  }
)

router.get('/recent',
  async (req, res) => {
    if(!isValidRequest(req, res)) return;
    const username = config.auth ? req.user.name : 'admin';

    try {
      let history = await db.getHistoryGroupByWorkId(username,config.recentCount)

      history.map(record => {
        record.work_id = parseInt(record.work_id);
        record.file_index = parseInt(record.file_index);
      })

      res.send(history)
    } catch(err) {
      console.log(err)
      res.status(500).send({ error: '服务器错误' });
    }
  },
)
  router.get('/deleteRecent',
  async (req, res) => {
    if(!isValidRequest(req, res)) return;
    const username = config.auth ? req.user.name : 'admin';

    try {
      await db.deleteHistoryByUserName(username)
    } catch(err) {
      console.log(err)
      res.status(500).send({ error: '服务器错误' });
    }
  }
)


module.exports = router;