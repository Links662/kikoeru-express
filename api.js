const routes = require('./routes')
const expressJwtModule = require('express-jwt');

const { config } = require('./config');
const { issuer, audience } = require('./auth/utils')

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


module.exports = (app) => {
  if (config.auth) {
    // requestProperty: 'user' 是必须的：express-jwt 7 起默认把 payload 放进 req.auth，
    // 而本项目所有路由都读 req.user（旧版 6.x 的默认值就是 'user'）。
    const jwtMiddleware = expressJwt({ secret: config.jwtsecret, audience: audience, issuer: issuer, getToken, algorithms: ['HS256'], requestProperty: 'user' });

    // 旧代码用 express-jwt@6 的 .unless({ path: [...] }) 放行登录/健康检查；express-jwt@8 没有 .unless()，
    // 这里按完整路径显式跳过这两个路径（与旧版实测行为一致），其余 /api 路由仍然要求 JWT。
    const publicPaths = new Set(['/api/auth/me', '/api/health']);
    app.use('/api', (req, res, next) => {
      if (publicPaths.has(req.originalUrl.split('?')[0])) return next();
      return jwtMiddleware(req, res, next);
    });
  }

  app.use('/api', routes);
};
