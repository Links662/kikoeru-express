const { CronExpressionParser } = require('cron-parser');

const getDefaultTimezone = () => (
  String(process.env.TZ || '').trim() || 'UTC'
);

const normalizeCronExpression = expression => String(expression || '')
  .trim()
  .replace(/\s+/g, ' ');

/**
 * 只接受标准五段 Cron：分、时、日、月、周。
 * 不允许秒级表达式，避免管理员误配后持续触发扫描。
 */
const parseCron = (expression, options = {}) => {
  const normalized = normalizeCronExpression(expression);
  const fields = normalized.split(' ').filter(Boolean);
  if (fields.length !== 5) {
    throw new Error('Cron 表达式必须为五段：分 时 日 月 周');
  }

  const timezone = options.timezone || getDefaultTimezone();
  let interval;
  try {
    interval = CronExpressionParser.parse(normalized, {
      currentDate: options.from || new Date(),
      tz: timezone
    });
  } catch (err) {
    throw new Error(`Cron 表达式无效: ${err.message}`);
  }

  return { normalized, timezone, interval };
};

const getNextRuns = (expression, count = 3, options = {}) => {
  const { interval } = parseCron(expression, options);
  const runs = [];
  for (let index = 0; index < count; index++) {
    runs.push(interval.next().toDate().toISOString());
  }
  return runs;
};

const getNextRun = (expression, options = {}) => getNextRuns(expression, 1, options)[0];

const formatDateTime = (value, timezone = getDefaultTimezone()) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
};

module.exports = {
  getDefaultTimezone,
  normalizeCronExpression,
  parseCron,
  getNextRun,
  getNextRuns,
  formatDateTime
};
