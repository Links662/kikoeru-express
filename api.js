const routes = require('./routes')
const expressJwtModule = require('express-jwt');

const { config } = require('./config');
const { issuer, audience } = require('./auth/utils')
const db = require('./database/db');

// express-jwt 7 起改为命名导出（6.x 是直接导出函数），这里两种形态都兼容
const expressJwt = expressJwtModule.expressjwt || expressJwtModule;

/**
 * Get token from header or query string.
 */
const getToken = (req) => {
  if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
      return req.headers.authorization.split(' ')[1];
  } else if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
}

/**
 * 不需要 JWT 的接口：健康检查，以及登录本身（POST /api/auth/me）。
 * GET /api/auth/me 是「当前用户是谁」，必须带 token。
 */
const isPublicRequest = (req) => {
  const path = req.originalUrl.split('?')[0];
  if (path === '/api/health') return true;
  return path === '/api/auth/me' && req.method === 'POST';
};

/**
 * JWT 只证明「这个 token 是本站签发的」，不代表账号此刻还有效：
 * token 有效期 30 天，期间账号可能被禁用、被删、被改过用户组。
 * 所以每个请求都回库核对一次账号状态，并把 req.user 刷新成数据库里的当前值。
 */
const verifyUserState = async (req, res, next) => {
  const name = req.user && req.user.name;
  if (!name) return next();

  try {
    const user = await db.getUserState(name);
    if (!user) {
      return res.status(401).send({ error: '该账号已被删除，请重新登录.' });
    }
    if (user.disabled === 1) {
      return res.status(401).send({ error: '该账号已被禁用，请重新登录.' });
    }

    // 用户组以数据库为准，避免 token 里的旧用户组一直生效
    req.user = Object.assign({}, req.user, { name: user.name, group: user.group });
    return next();
  } catch (err) {
    return next(err);
  }
};


module.exports = (app) => {
  if (config.auth) {
    // requestProperty: 'user' 是必须的：express-jwt 7 起默认把 payload 放进 req.auth，
    // 而本项目所有路由都读 req.user（旧版 6.x 的默认值就是 'user'）。
    const jwtMiddleware = expressJwt({ secret: config.jwtsecret, audience: audience, issuer: issuer, getToken, algorithms: ['HS256'], requestProperty: 'user' });

    // 旧代码用 express-jwt@6 的 .unless({ path: [...] }) 放行登录/健康检查；express-jwt@8 没有 .unless()，
    // 这里显式跳过登录与健康检查，其余 /api 路由仍然要求 JWT，并在通过后核对账号状态。
    app.use('/api', (req, res, next) => {
      if (isPublicRequest(req)) return next();
      return jwtMiddleware(req, res, (err) => {
        if (err) return next(err);
        return verifyUserState(req, res, next);
      });
    });
  }

  app.use('/api', routes);
};
