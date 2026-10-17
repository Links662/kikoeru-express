// DLsite 的 6 位 RJ 数字部分小于 1,000,000，8 位 RJ 从 1,000,000 开始。
const SIX_DIGIT_LIMIT = 1000000;

const normalizeWorkId = (id) => {
  if (id === null || id === undefined || (typeof id === 'string' && id.trim() === '')) {
    throw new TypeError(`Invalid work id: ${id}`);
  }

  const num = Number(id);
  if (!Number.isSafeInteger(num) || num < 0) {
    throw new TypeError(`Invalid work id: ${id}`);
  }

  return num;
};

/**
 * 把 work id 格式化成完整的 DLsite RJ 文本。
 * @param {Number|String} id work id
 * @returns {String} 例如 RJ01731224
 */
const formatRJLabel = (id) => {
  const num = normalizeWorkId(id);
  const width = num >= SIX_DIGIT_LIMIT ? 8 : 6;
  const code = String(num).padStart(width, '0');

  if (code.length > width) {
    throw new RangeError(`Work id is too long: ${id}`);
  }

  return `RJ${code}`;
};

module.exports = {
  formatRJLabel,
};
