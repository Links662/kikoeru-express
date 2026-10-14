const express = require('express');
const { check, validationResult } = require('express-validator');
const expressJwtModule = require('express-jwt');

// express-jwt 7 起改为命名导出（6.x 是直接导出函数），这里两种形态都兼容
const expressJwt = expressJwtModule.expressjwt || expressJwtModule;

const { signToken, md5 } = require('../auth/utils');
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
], (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).send({ errors: errors.array() });
  }

  const name = req.body.name;
  const password = req.body.password;

  db.knex('t_user')
    .where('name', '=', name)
    .andWhere('password', '=', md5(password))
    .first()
    .then((user) => {
      if (!user) {
        res.set("WWW-Authenticate", "Bearer realm=\"Authorization Required\"");
        res.status(401).send({error: '用户名或密码错误.'});
      } else {
        const token = signToken(user);
        res.send({ token });
      }
    })
    .catch((err) => {
      console.error(err);
      res.status(500).send({error: '服务器错误'});
    });
});

if (config.auth) {
  // requestProperty 说明见 api.js：express-jwt 7+ 默认写 req.auth，这里保持 req.user
  router.get('/me', expressJwt({ secret: config.jwtsecret, algorithms: ['HS256'], requestProperty: 'user' }));
}

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
