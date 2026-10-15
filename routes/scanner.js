const express = require('express');
const router = express.Router();
const { config } = require('../config');
const scannerState = require('../state/scannerState');

// 扫描进度快照；socket 不可用（代理拦截 websocket、断线且重连失败等）时前端退化为轮询此接口
router.get('/state', (req, res) => {
  if (config.auth && req.user.group !== 'administrator') {
    res.status(403).send({ error: '只有 administrator 账号能查看扫描状态.' });
    return;
  }

  res.send(scannerState.getSnapshot());
});

module.exports = router;
