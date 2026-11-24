const _ = require('lodash'); 
const express = require('express');
const router = express.Router();
const {
  config,
  bootstrapKeys,
  runtimeKeys,
  setBootstrapConfig,
  sharedConfigHandle
} = require('../config');
const { saveRuntimeSettings } = require('../settings');

const filterConfig = (_config, option = 'read') => {
  const currentConfig = config;
  const configClone = _.cloneDeep(_config);
  delete configClone.md5secret;
  delete configClone.jwtsecret;
  if (option === 'write') {
    delete configClone.production;
    if (process.env.NODE_ENV === 'production' || currentConfig.production) {
      delete configClone.auth;
    }
  }
  return configClone;
}

router.put('/admin', async (req, res, next) => {
  if (!config.auth || req.user.group === 'administrator') {
    try {
      const incomingConfig = filterConfig(req.body.config, 'write');
      await saveRuntimeSettings(_.pick(incomingConfig, runtimeKeys));
      setBootstrapConfig(_.pick(incomingConfig, bootstrapKeys));
      res.send({
        message: '保存成功.',
        config: filterConfig(config, 'read')
      })
    } catch(err) {
      next(err);
    }
  } else {
    res.status(403).send({ error: '只有 administrator 账号能修改配置文件.' });
  }
});

router.get('/admin', (req, res, next) => {
  if (!config.auth || req.user.group === 'administrator') {
    try {
      res.send({ config: filterConfig(config, 'read') });
    } catch(err) {
      next(err);
    }
  } else {
    res.status(403).send({ error: '只有 administrator 账号能读取管理配置文件.' });
  }
});

router.get('/shared', (req, res, next) => {
  try {
    res.send({ sharedConfig: sharedConfigHandle.export() });
  } catch(err) {
    next(err);
  }
});

module.exports = router;
