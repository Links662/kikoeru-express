const express = require('express');
const router = express.Router();
const { check, body, validationResult } = require('express-validator');
const { hashPassword } = require('../auth/password');
const { config } = require('../config');
const db = require('../database/db');
const { closeUserSockets } = require('../state/userSockets');

const USER_GROUPS = ['user', 'administrator'];

// 关闭用户验证时（config.auth === false）等于所有人都是管理员，这是原有的本地开发行为
const isAdministrator = req => !config.auth || (req.user !== undefined && req.user.group === 'administrator');

// db.js 里带 status 的错误（权限 / 不存在等）按原样返回，其余交给全局错误处理
const sendDbError = (res, next, err) => {
  if (err.status) return res.status(err.status).send({ error: err.message });
  return next(err);
};

const toBoolean = value => value === true || value === 'true' || value === 1 || value === '1';

router.post('/user', [
  check('name')
    .isLength({ min: 5 })
    .withMessage('用户名长度至少为 5'),
  check('password')
    .isLength({ min: 5 })
    .withMessage('密码长度至少为 5'),
  check('group')
    .custom(value => {
      if (!USER_GROUPS.includes(value)) {
        throw new Error(`用户组名称必须为 ['user', 'administrator'] 的一个.`)
      }
      return true
    })
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).send({ errors: errors.array() });
  }

  const user = {
    name: req.body.name,
    password: req.body.password,
    group: req.body.group
  };

  if (!isAdministrator(req)) {
    return res.status(403).send({ error: '只有 administrator 账号能创建新用户.' });
  }

  try {
    await db.createUser({
      name: user.name,
      password: await hashPassword(user.password),
      group: user.group
    });
    res.send({ message: `用户 ${user.name} 创建成功.` });
  } catch (err) {
    sendDbError(res, next, err);
  }
});

router.put('/user', [
  check('name')
    .isLength({ min: 5 })
    .withMessage('用户名长度至少为 5'),
  check('newPassword')
    .isLength({ min: 5 })
    .withMessage('密码长度至少为 5')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({errors: errors.array()});
  }

  const user = {
    name: req.body.name
  };
  const isSelf = req.user !== undefined && req.user.name === user.name;

  if (!config.auth || isAdministrator(req) || isSelf) {
    try {
      await db.updateUserPassword(user, await hashPassword(req.body.newPassword));
      res.send({ message: '密码修改成功.' });
    } catch (err) {
      sendDbError(res, next, err);
    }
  } else {
    return res.status(403).send({ error: '只能修改自己账号的密码.' });
  }
});

/**
 * 启用 / 禁用账号。
 *
 * 禁用是删除之外的第二条路：内置的 admin 不允许删除，但允许禁用（这也是它唯一的
 * 下线方式）。禁用后该账号不能登录，已经签发的 token 也立刻失效，而它的评语、
 * 收藏、历史记录都保留。
 *
 * 唯一硬性限制：不能把最后一个已启用的管理员禁掉，否则管理后台就没人能进了。
 */
router.put('/user/status', [
  check('name')
    .isLength({ min: 5 })
    .withMessage('用户名长度至少为 5'),
  body('disabled')
    .isBoolean()
    .withMessage('disabled 必须为布尔值')
], (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).send({ errors: errors.array() });
  }

  if (!isAdministrator(req)) {
    return res.status(403).send({ error: '只有 administrator 账号能启用或禁用用户.' });
  }

  const name = req.body.name;
  const disabled = toBoolean(req.body.disabled);

  db.setUserDisabled(name, disabled)
    .then((result) => {
      if (disabled && result.changed) {
        // 管理后台的 socket 也带着 token，禁用后要主动断开，前端才会回到登录页
        closeUserSockets(name);
      }

      res.send({
        message: disabled ? `用户 ${name} 已禁用.` : `用户 ${name} 已启用.`,
        user: { name: result.name, disabled: result.disabled },
      });
    })
    .catch((err) => sendDbError(res, next, err));
});

router.delete('/user', [
  body('users')
    .isArray({ min: 1 })
    .withMessage('users 必须是非空数组'),
  body('users.*.name')
    .isString()
    .withMessage('users 中的每一项都必须包含用户名字符串')
], (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).send({ errors: errors.array() });
  }

  if (!isAdministrator(req)) {
    return res.status(403).send({ error: '只有 administrator 账号能删除用户.' });
  }

  const names = req.body.users.map(user => user.name);

  db.deleteUser(names)
    .then((result) => {
      closeUserSockets(result.deleted);
      res.send({ message: '删除成功.', deleted: result.deleted });
    })
    .catch((err) => sendDbError(res, next, err));
});

router.get('/users', (req, res, next) => {
  if (!isAdministrator(req)) {
    return res.status(403).send({ error: '只有 administrator 账号能浏览用户.' });
  }

  db.knex('t_user')
    .select('name', 'group', 'disabled')
    .orderBy('name', 'asc')
    .then((users) => {
      res.send({ users });
    })
    .catch((err) => {
      next(err);
    });
});

module.exports = router;
