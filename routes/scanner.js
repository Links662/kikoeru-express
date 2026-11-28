const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const { config } = require('../config');
const db = require('../database/db');
const scannerState = require('../state/scannerState');
const scanScheduler = require('../state/scanScheduler');
const { isValidRequest } = require('./utils/validate');
const {
  formatDateTime,
  getNextRuns,
  normalizeCronExpression,
  parseCron
} = require('../utils/cron');

const { SCAN_KINDS } = scannerState;

const isAdministrator = req => (
  !config.auth || (req.user !== undefined && req.user.group === 'administrator')
);

const validateCron = value => {
  parseCron(value);
  return true;
};

const createCronValidator = (optional = false) => {
  let validator = body('cronExpression');
  if (optional) validator = validator.optional();
  return validator
    .isString()
    .withMessage('cronExpression 必须为字符串')
    .customSanitizer(normalizeCronExpression)
    .notEmpty()
    .withMessage('请输入 Cron 表达式')
    .isLength({ max: 128 })
    .withMessage('Cron 表达式不能超过 128 个字符')
    .custom(validateCron);
};

const typeValidator = body('type')
  .isIn(SCAN_KINDS)
  .withMessage(`扫描操作必须为 ${SCAN_KINDS.join(', ')} 之一`);

const requireAdministrator = (req, res) => {
  if (isAdministrator(req)) return true;
  res.status(403).send({ error: '只有 administrator 账号能管理扫描自动化.' });
  return false;
};

const sendDbError = (res, next, err) => {
  if (err.status) {
    return res.status(err.status).send({ error: err.message });
  }
  if (err.code === 'SQLITE_CONSTRAINT' || /UNIQUE constraint failed/i.test(err.message)) {
    return res.status(409).send({ error: '相同的扫描操作和 Cron 配置已经存在.' });
  }
  return next(err);
};

const sendAutomationList = async (res, next, notify = false) => {
  try {
    if (notify) await scanScheduler.refresh();
    res.send({
      automations: await scanScheduler.list()
    });
  } catch (err) {
    next(err);
  }
};

// 扫描进度快照；socket 不可用（代理拦截 websocket、断线且重连失败等）时前端退化为轮询此接口
router.get('/state', (req, res) => {
  if (!requireAdministrator(req, res)) return;
  res.send(scannerState.getSnapshot());
});

router.get('/automations', (req, res, next) => {
  if (!requireAdministrator(req, res)) return;
  sendAutomationList(res, next);
});

router.post('/automations/preview', [
  createCronValidator()
], (req, res, next) => {
  if (!requireAdministrator(req, res)) return;
  if (!isValidRequest(req, res)) return;

  try {
    const timezone = scanScheduler.getTimezone();
    res.send({
      cronExpression: req.body.cronExpression,
      nextRuns: getNextRuns(req.body.cronExpression, 3, {
        timezone
      }).map(value => ({
        value,
        label: formatDateTime(value, timezone)
      }))
    });
  } catch (err) {
    next(err);
  }
});

router.post('/automations', [
  typeValidator,
  createCronValidator(),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled 必须为布尔值')
    .toBoolean()
], async (req, res, next) => {
  if (!requireAdministrator(req, res)) return;
  if (!isValidRequest(req, res)) return;

  try {
    const automation = await db.createScanAutomation({
      type: req.body.type,
      cronExpression: req.body.cronExpression,
      enabled: req.body.enabled !== false
    });
    await scanScheduler.refresh();
    res.status(201).send({
      message: '扫描自动化已创建.',
      automation
    });
  } catch (err) {
    sendDbError(res, next, err);
  }
});

router.put('/automations/:id', [
  param('id')
    .isInt({ min: 1 })
    .withMessage('自动化 ID 必须为正整数')
    .toInt(),
  body('type')
    .optional()
    .isIn(SCAN_KINDS)
    .withMessage(`扫描操作必须为 ${SCAN_KINDS.join(', ')} 之一`),
  createCronValidator(true),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('enabled 必须为布尔值')
    .toBoolean()
], async (req, res, next) => {
  if (!requireAdministrator(req, res)) return;
  if (!isValidRequest(req, res)) return;

  const changes = {};
  for (const field of ['type', 'cronExpression', 'enabled']) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      changes[field] = req.body[field];
    }
  }
  if (Object.keys(changes).length === 0) {
    return res.status(400).send({ error: '没有需要修改的自动化配置.' });
  }

  try {
    const automation = await db.updateScanAutomation(req.params.id, changes);
    if (!automation) {
      return res.status(404).send({ error: '扫描自动化不存在.' });
    }
    await scanScheduler.refresh();
    res.send({
      message: '扫描自动化已更新.',
      automation
    });
  } catch (err) {
    sendDbError(res, next, err);
  }
});

router.delete('/automations/:id', [
  param('id')
    .isInt({ min: 1 })
    .withMessage('自动化 ID 必须为正整数')
    .toInt()
], async (req, res, next) => {
  if (!requireAdministrator(req, res)) return;
  if (!isValidRequest(req, res)) return;

  try {
    const deleted = await db.deleteScanAutomation(req.params.id);
    if (!deleted) {
      return res.status(404).send({ error: '扫描自动化不存在.' });
    }
    await scanScheduler.refresh();
    res.send({ message: '扫描自动化已删除.' });
  } catch (err) {
    sendDbError(res, next, err);
  }
});

module.exports = router;
