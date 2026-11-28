const LimitPromise = require('limit-promise');
const { config } = require('../../config');

const createParallelLimiter = () => new LimitPromise(
  Math.max(1, Number(config.maxParallelism) || 16)
);

module.exports = { createParallelLimiter };
