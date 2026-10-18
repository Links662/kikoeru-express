const { v5: uuidv5 } = require('uuid');

const nameToUUID = (name) => {
  const namespace =  '699d9c07-b965-4399-bafd-18a3cacf073c';
  return uuidv5(name, namespace);
};

/**
 * 判断一个字符串中是否包含字母
 * @param {String} str
 */
const hasLetter = (str) => {
  for (let i in str) {
    let asc = str.charCodeAt(i);
    if ((asc >= 65 && asc <= 90 || asc >= 97 && asc <= 122)) {
      return true;
    }
  }
  return false;
};

/**
 * DLsite 年龄分级缺失或为空时按 R18 处理，避免漏标成人作品。
 */
const nsfwFromAgeRating = ageRating => {
  const value = typeof ageRating === 'string' ? ageRating.trim().toUpperCase() : '';
  return value === '' || value === 'R18';
};

/**
 * HVDB 的 SFW 字段只有明确为 true 时才视为全年龄。
 */
const nsfwFromSfwFlag = value => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized !== 'true';
};

module.exports = {
  nameToUUID, hasLetter, nsfwFromAgeRating, nsfwFromSfwFlag
};
