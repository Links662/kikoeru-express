const express = require('express');
const router = express.Router();
const { config } = require('../config');
const db = require('../database/db');
const { query, body } = require('express-validator');
const { isValidRequest } = require('./utils/validate');
const { emitToUser } = require('../state/userSockets');

const normalizeHistoryRecord = (history) => {
  if (!history) return history;

  return {
    ...history,
    work_id: Number(history.work_id),
    file_index: Number(history.file_index),
    nsfw: Boolean(history.nsfw)
  };
};

router.put('/',
  body('work_id').isInt(),
  body('file_index').isInt(),
  body('file_name').isString(),
  body('play_time'),
  body('total_time'),
  async (req, res) => {
    if (!isValidRequest(req, res)) return;

    const username = config.auth ? req.user.name : 'admin';
    const workId = parseInt(req.body.work_id);
    const fileIndex = parseInt(req.body.file_index);

    try {
      await db.insertHistory(
        username,
        workId,
        fileIndex,
        req.body.file_name,
        parseInt(req.body.play_time),
        parseInt(req.body.total_time)
      );

      // 写入成功后只通知该账号，主界面的历史列表可以立即做增量更新。
      const history = normalizeHistoryRecord(
        await db.getHistoryByWorkId(username, workId, fileIndex)
      );
      if (history) {
        emitToUser(username, 'HISTORY_UPDATED', {
          history,
          limit: config.recentCount
        });
      }

      res.send({ message: '历史记录添加成功' });
    } catch (err) {
      res.status(500).send({ error: '添加失败，服务器错误' });
      console.error(err);
    }
  }
);

router.get('/getByWorkIdIndex',
  query('work_id'),
  query('file_index'),
  async (req, res) => {
    if (!isValidRequest(req, res)) return;

    const username = config.auth ? req.user.name : 'admin';

    try {
      const history = normalizeHistoryRecord(
        await db.getHistoryByWorkId(
          username,
          req.query.work_id,
          req.query.file_index
        )
      );

      res.send(history);
    } catch (err) {
      console.log(err);
      res.status(500).send({ error: '服务器错误' });
    }
  }
);

router.get('/recent',
  async (req, res) => {
    if (!isValidRequest(req, res)) return;
    const username = config.auth ? req.user.name : 'admin';

    try {
      const history = (
        await db.getHistoryGroupByWorkId(username, config.recentCount)
      ).map(normalizeHistoryRecord);

      res.send(history);
    } catch (err) {
      console.log(err);
      res.status(500).send({ error: '服务器错误' });
    }
  }
);

router.delete('/recent',
  async (req, res) => {
    if (!isValidRequest(req, res)) return;
    const username = config.auth ? req.user.name : 'admin';

    try {
      await db.deleteHistoryByUserName(username);
      res.send({ message: '历史记录已清空' });
    } catch (err) {
      console.log(err);
      res.status(500).send({ error: '服务器错误' });
    }
  }
);

module.exports = router;
