const express = require('express');
const { check, validationResult } = require('express-validator');

const { signToken } = require('../auth/utils');
const { verifyPassword, fakeVerifyPassword, isScryptHash } = require('../auth/password');
const db = require('../database/db');

const { config } = require('../config');

const router = express.Router();

// 用户登录
router.post('/me', [
  check('name')
    .isLength({ min: 5 })
    .withMessage('用户名长度至少为 5'),
  check('password')
    .isLength({ min: 5 })
    .withMessage('密码长度至少为 5')
// eslint-disable-next-line no-unused-vars
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).send({ errors: errors.array() });
  }

  const name = req.body.name;
  const password = req.body.password;

  try {
    const user = await db.knex('t_user').where('name', '=', name).first();
    if (!user) {
      // 账号不存在也做一次等价耗时的哈希校验，避免被拿来探测用户名
      await fakeVerifyPassword(password);
      res.set("WWW-Authenticate", "Bearer realm=\"Authorization Required\"");
      return res.status(401).send({error: '用户名或密码错误.'});
    }

    if (!(await verifyPassword(password, user.password))) {
      if (!isScryptHash(user.password)) {
        // 老版本留下的 md5 哈希已经不认了，这里给一条明确的排查线索
        console.warn(` ! 用户 ${user.name} 的密码哈希不是 scrypt 格式（老数据），需要用重置模式重新设置密码。`);
      }
      res.set("WWW-Authenticate", "Bearer realm=\"Authorization Required\"");
      return res.status(401).send({error: '用户名或密码错误.'});
    }
    if (user.disabled === 1) {
      // 账号已被禁用：密码正确也不签发 token
      return res.status(403).send({error: '该账号已被禁用，请联系管理员.'});
    }

    const token = signToken(user);
    res.send({ token });
  } catch (err) {
    console.error(err);
    res.status(500).send({error: '服务器错误'});
  }
});

// JWT 校验与账号状态核对统一在 api.js 的 /api 中间件里完成（GET /api/auth/me 不在放行名单内）
// eslint-disable-next-line no-unused-vars
router.get('/me', (req, res, next) => {
  // 同时告诉客户端，服务器是否启用用户验证
  const auth = config.auth;
  const user = config.auth
    ? { name: req.user.name, group: req.user.group }
    : { name: 'admin', group: 'administrator' }
  res.send({ user, auth });
});

module.exports = router;
