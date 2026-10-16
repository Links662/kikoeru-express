const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT_LENGTH = 16;
// 实际需要 128*N*r 字节（默认档位是 128 MiB），Node 默认 maxmem 只有 32 MiB，必须放开
const SCRYPT_MAX_MEM = 512 * 1024 * 1024;

const HASH_PREFIX = '$scrypt$';

const formatParams = params => `n=${params.N},r=${params.r},p=${params.p}`;

const derive = (plain, salt, params) => scryptAsync(plain, salt, SCRYPT_KEY_LENGTH, {
  N: params.N,
  r: params.r,
  p: params.p,
  maxmem: SCRYPT_MAX_MEM,
});

const isScryptHash = stored => typeof stored === 'string' && stored.startsWith(HASH_PREFIX);

/**
 * 生成密码哈希
 * @param {String} plain 明文密码
 * @returns {Promise<String>} $scrypt$... 格式的哈希串（每次都用新的随机盐）
 */
const hashPassword = async (plain) => {
  const salt = crypto.randomBytes(SCRYPT_SALT_LENGTH);
  const derived = await derive(plain, salt, SCRYPT_PARAMS);

  return `${HASH_PREFIX}${formatParams(SCRYPT_PARAMS)}$${salt.toString('base64')}$${derived.toString('base64')}`;
};

// $scrypt$n=..,r=..,p=..$salt$hash
const parseHash = (stored) => {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[1] !== 'scrypt') return null;

  const numbers = {};
  for (const pair of parts[2].split(',')) {
    const [key, value] = pair.split('=');
    numbers[key] = Number(value);
  }

  const salt = Buffer.from(parts[3], 'base64');
  const hash = Buffer.from(parts[4], 'base64');

  // 参数来自数据库，仍然挡一下异常值，避免被塞进一个巨大的 N 把内存吃光
  const valid = Number.isInteger(numbers.n) && numbers.n >= 1024 && numbers.n <= 2 ** 18
    && Number.isInteger(numbers.r) && numbers.r >= 1 && numbers.r <= 8
    && Number.isInteger(numbers.p) && numbers.p >= 1 && numbers.p <= 4
    && salt.length >= 8 && hash.length > 0;

  if (!valid) return null;

  return { params: { N: numbers.n, r: numbers.r, p: numbers.p }, salt, hash };
};

/**
 * 校验密码。只认本文件的 scrypt 哈希：老格式（md5）或损坏的串一律返回 false。
 * @param {String} plain 明文密码
 * @param {String} stored 数据库里存的哈希串
 * @returns {Promise<Boolean>}
 */
const verifyPassword = async (plain, stored) => {
  if (!isScryptHash(stored)) return false;

  const parsed = parseHash(stored);
  if (parsed === null) return false;

  try {
    const derived = await derive(plain, parsed.salt, parsed.params);
    return derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
  } catch (err) {
    // 参数不合法 / 超出内存上限等情况按“密码错误”处理
    return false;
  }
};

let dummyHash = null;

/**
 * 账号不存在时也走一遍等价的哈希计算，避免用响应时间探测用户名是否存在。
 */
const fakeVerifyPassword = async (plain) => {
  if (dummyHash === null) {
    dummyHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  }
  await verifyPassword(plain, dummyHash);
};

module.exports = {
  hashPassword,
  verifyPassword,
  fakeVerifyPassword,
  isScryptHash,
};
