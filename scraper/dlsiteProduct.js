const axios = require('./axios');
const { nameToUUID } = require('./utils');
const { formatRJLabel } = require('../utils/workId');

const DEFAULT_TAG_LANGUAGE = 'zh-cn';

const localeFromTagLanguage = (language) => {
  const normalized = typeof language === 'string' && language.trim()
    ? language.trim().toLowerCase()
    : DEFAULT_TAG_LANGUAGE;

  switch (normalized) {
    case 'ja-jp':
      return 'ja-JP';
    case 'zh-tw':
      return 'zh-TW';
    case 'zh-cn':
      return 'zh-CN';
    default:
      return normalized;
  }
};

/**
 * 构建 DLsite product.json 请求地址。
 * @param {String} rjLabel 完整的 RJ 编号。
 * @param {String} locale 接口语言，由配置中的 tagLanguage 映射得到。
 */
const buildProductApiUrl = (rjLabel, locale) => (
  `https://www.dlsite.com/maniax/api/=/product.json?workno=${rjLabel}` +
  (locale ? `&locale=${locale}` : '')
);

/**
 * DLsite product.json 的年龄分级：明确标记为 adult 或 3 时视为 R18，
 * 字段缺失或无法识别时按 R18 处理。
 */
const nsfwFromAgeCategory = (category, categoryString) => {
  const value = typeof categoryString === 'string'
    ? categoryString.trim().toLowerCase()
    : '';

  if (value) {
    return value === 'adult' || value === 'r18';
  }

  const numericCategory = Number(category);
  if (Number.isFinite(numericCategory)) {
    return numericCategory === 3;
  }

  return true;
};

const toDateOnly = (value) => {
  if (typeof value !== 'string') return '';
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
};

const parseNumericId = (value) => {
  const match = String(value || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
};

const normalizeTags = (item) => {
  const genres = Array.isArray(item.genres)
    ? item.genres
    : (Array.isArray(item.genres_replaced) ? item.genres_replaced : []);
  const seen = new Set();
  const tags = [];

  for (const genre of genres) {
    const id = Number(genre.id || genre.search_val);
    const name = genre.name || genre.name_base;
    if (!Number.isFinite(id) || !name || seen.has(id)) continue;

    seen.add(id);
    tags.push({ id, name });
  }

  return tags;
};

const normalizeVas = (item) => {
  const voiceBy = item.creaters && Array.isArray(item.creaters.voice_by)
    ? item.creaters.voice_by
    : [];
  const seen = new Set();
  const vas = [];

  for (const va of voiceBy) {
    const name = typeof va.name === 'string' ? va.name.trim() : '';
    if (!name || seen.has(name)) continue;

    seen.add(name);
    vas.push({ id: nameToUUID(name), name });
  }

  return vas;
};

const normalizeRateCountDetail = (item) => {
  const detail = item.rate_count_detail;

  if (Array.isArray(detail)) {
    return [1, 2, 3, 4, 5].map((point) => {
      const entry = detail.find(value => Number(value.review_point) === point) || {};
      return {
        review_point: point,
        count: Number(entry.count) || 0,
        ratio: Number(entry.ratio) || 0
      };
    });
  }

  const counts = [1, 2, 3, 4, 5].map(point => {
    if (!detail || typeof detail !== 'object') return 0;
    return Number(detail[point] || detail[String(point)]) || 0;
  });
  const total = counts.reduce((sum, count) => sum + count, 0);

  return counts.map((count, index) => ({
    review_point: index + 1,
    count,
    ratio: total ? Math.floor(count / total * 100) : 0
  }));
};

const normalizeRank = (item) => {
  const rankFields = [
    ['day', 'rank_day', 'rank_day_date'],
    ['week', 'rank_week', 'rank_week_date'],
    ['month', 'rank_month', 'rank_month_date'],
    ['year', 'rank_year', 'rank_year_date'],
    ['total', 'rank_total', 'rank_total_date']
  ];
  const ranks = [];

  for (const [term, rankField, dateField] of rankFields) {
    const rank = Number(item[rankField]);
    if (!item[rankField] || !Number.isFinite(rank) || rank <= 0) continue;

    ranks.push({
      term,
      category: 'all',
      rank,
      rank_date: toDateOnly(item[dateField])
    });
  }

  return ranks;
};

/**
 * 将 product.json 的单条作品数据转换成扫描器使用的元数据结构。
 * 这里不检查 on_sale，确保已下架作品也能写入数据库。
 * @param {Object|Array} data 接口响应。
 * @param {number} id Work id.
 */
const parseProductResponse = (data, id) => {
  const item = Array.isArray(data) ? data[0] : data;
  const rjLabel = formatRJLabel(id);

  if (!item || typeof item !== 'object') {
    throw new Error(`Couldn't parse data from DLsite product API for ${rjLabel}.`);
  }

  const title = item.work_name || item.work_name_masked ||
    item.product_name || item.alt_name;
  const circleId = parseNumericId(item.maker_id || item.circle_id);
  const rawCircleName = item.maker_name || item.circle_name || item.maker_name_en;
  const circleName = typeof rawCircleName === 'string'
    ? rawCircleName.trim()
    : '';
  const rateCountDetail = normalizeRateCountDetail(item);
  const detailCount = rateCountDetail.reduce((sum, entry) => sum + entry.count, 0);
  const rateCount = (item.rate_count !== undefined && item.rate_count !== null)
    ? Number(item.rate_count) || 0
    : detailCount;
  const weightedRate = rateCountDetail.reduce(
    (sum, entry) => sum + entry.review_point * entry.count,
    0
  );
  const rateAverage = (item.rate_average_2dp !== undefined && item.rate_average_2dp !== null)
    ? Number(item.rate_average_2dp)
    : (detailCount ? Number((weightedRate / detailCount).toFixed(2)) : 0.0);

  if (typeof title !== 'string' || !title.trim()) {
    throw new Error(`Couldn't find a work title in DLsite product API response for ${rjLabel}.`);
  }

  const work = {
    id,
    title: title.trim(),
    circle: (circleId && circleName) ? { id: circleId, name: circleName } : {},
    nsfw: nsfwFromAgeCategory(item.age_category, item.age_category_string),
    release: toDateOnly(item.release_date || item.regist_date),
    tags: normalizeTags(item),
    vas: normalizeVas(item),
    rate_count: rateCount,
    rate_average_2dp: rateAverage,
    rate_count_detail: rateCountDetail
  };

  if (item.price !== undefined && item.price !== null) {
    work.price = Number(item.price) || 0;
  }
  if (item.dl_count !== undefined && item.dl_count !== null) {
    work.dl_count = Number(item.dl_count) || 0;
  }
  if (item.review_count !== undefined && item.review_count !== null) {
    work.review_count = Number(item.review_count) || 0;
  }

  const rank = normalizeRank(item);
  work.rank = rank.length ? rank : null;

  const seriesId = parseNumericId(item.series_id);
  if (seriesId && item.series_name) {
    work.series = { id: seriesId, name: item.series_name };
  }

  return work;
};

/**
 * 请求 product.json 并转换元数据。该接口在旧作品页不可用时作为兜底。
 * @param {number} id Work id.
 * @param {String} language 标签语言，'ja-jp', 'zh-tw' or 'zh-cn'，默认'zh-cn'
 */
const scrapeWorkMetadataFromDLsiteProduct = (id, language) => new Promise((resolve, reject) => {
  const rjLabel = formatRJLabel(id);
  const locale = localeFromTagLanguage(language);
  const url = buildProductApiUrl(rjLabel, locale);

  axios.retryGet(url, { retry: {} })
    .then(response => parseProductResponse(response.data, id))
    .then(resolve)
    .catch((error) => {
      if (error.response) {
        // 请求已发出，但服务器响应的状态码不在 2xx 范围内
        reject(new Error(`Couldn't request DLsite product API (${url}), received: ${error.response.status}.`));
      } else {
        reject(error);
      }
    });
});

module.exports = {
  buildProductApiUrl,
  localeFromTagLanguage,
  parseProductResponse,
  scrapeWorkMetadataFromDLsiteProduct
};
