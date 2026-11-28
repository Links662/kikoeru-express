const cheerio = require('cheerio');

const axios = require('./axios');
const { hasLetter, nsfwFromAgeRating } = require('./utils');
const scrapeWorkMetadataFromHVDB = require('./hvdb');
const { formatRJLabel } = require('../utils/workId');
const { normalizeVoiceActorName } = require('../utils/voiceActorName');

const STATIC_METADATA_SOURCES = {
  PRODUCT: 'product',
  HTML: 'html'
};
const TAG_CATALOG_LANGUAGES = ['ja-jp', 'zh-cn', 'zh-tw'];

const dlsiteBlockedError = message => Object.assign(new Error(message), {
  code: 'DLSITE_BLOCKED',
  isDlsiteBlocked: true
});

const getResponseStatus = error => (
  error && error.response && Number(error.response.status)
) || null;

const isDlsiteBlockedError = error => Boolean(
  error && (
    error.code === 'DLSITE_BLOCKED' ||
    error.isDlsiteBlocked ||
    [401, 403, 429].includes(getResponseStatus(error))
  )
);

const isDlsiteChallengeResponse = data => (
  typeof data === 'string' &&
  /(?:cloudflare|access denied|just a moment|attention required)/i.test(data)
);

const requestError = (error, url, label) => {
  const status = error && error.response && error.response.status;
  const wrapped = new Error(status
    ? `${label} (${url}), received: ${status}.`
    : `${label} (${url}): ${error.message}`);
  if (isDlsiteBlockedError(error)) {
    wrapped.code = 'DLSITE_BLOCKED';
    wrapped.isDlsiteBlocked = true;
  }
  return wrapped;
};

/**
 * Scrapes static work metadata from public DLsite page HTML.
 * @param {number} id Work id.
 */
const scrapeHtmlWorkMetadataFromDLsite = (id) => new Promise((resolve, reject) => {
  const rjLabel = formatRJLabel(id);
  const url = `https://www.dlsite.com/maniax/work/=/product_id/${rjLabel}.html`;

  // 抓源缺少年龄字段时按 R18 处理，保证交给持久层的元数据字段完整。
  const work = { id, nsfw: true, tags: [], vas: [] };
  let AGE_RATINGS, VA, GENRE, RELEASE, SERIES, COOKIE_LOCALE;
  COOKIE_LOCALE = 'locale=ja-jp';
  AGE_RATINGS = '年齢指定';
  GENRE = 'ジャンル';
  VA = '声優';
  RELEASE = '販売日';
  SERIES = 'シリーズ名';

  axios.retryGet(url, {
    retry: {},
    headers: { "cookie": COOKIE_LOCALE }
  })
    .then(response => response.data)
    .then((data) => {
      const $ = cheerio.load(data);

      // 标题
      work.title = $('meta[property="og:title"]').attr('content');
      // fallback
      if (work.title === undefined) {
        work.title = $(`a[href="${url}"] span`).text();
      }

      // 'xxxxx [circle_name] | DLsite' => 'xxxxx'
      const titlePattern = / \[.+\] \| DLsite$/;
      work.title = work.title.replace(titlePattern, '');

      // 社团
      const circleElement = $('span[class="maker_name"]').children('a');
      const circleUrl = circleElement.attr('href');
      const circleName = circleElement.text();
      work.circle = (circleUrl && circleName)
        ? { id: parseInt(circleUrl.substr(-10, 5)), name: circleName }
        : {};

      const workOutline = $('#work_outline');
      // NSFW
      const R18 = workOutline.children('tbody').children('tr').children('th')
        .filter(function () {
          return $(this).text() === AGE_RATINGS;
        }).parent().children('td').find('span:first').text();
      work.nsfw = nsfwFromAgeRating(R18);

      // 贩卖日 (YYYY-MM-DD)
      const release = workOutline.children('tbody').children('tr').children('th')
        .filter(function () {
          return $(this).text() === RELEASE;
        }).parent().children('td').text().replace(/[^0-9]/ig, '');
      work.release = (release.length >= 8)
        ? `${release.slice(0, 4)}-${release.slice(4, 6)}-${release.slice(6, 8)}`
        : '';

      // 系列
      const seriesElement = workOutline.children('tbody').children('tr').children('th')
        .filter(function () {
          return $(this).text() === SERIES;
        }).parent().children('td').children('a');
      if (seriesElement.length) {
        const seriesUrl = seriesElement.attr('href');
        if (seriesUrl.match(/SRI(\d{10})/)) {
          work.series = {
            id: parseInt(seriesUrl.match(/SRI(\d{10})/)[1]),
            name: seriesElement.text()
          };
        }
      }

      // 标签
      workOutline.children('tbody').children('tr').children('th')
        .filter(function () {
          return $(this).text() === GENRE;
        }).parent().children('td').children('div').children('a').each(function () {
          const tagUrl = $(this).attr('href');
          if (tagUrl.match(/genre\/(\d{3})/)) {
            work.tags.push({
              id: parseInt(tagUrl.match(/genre\/(\d{3})/)[1])
            });
          }
        });

      // 声优
      workOutline.children('tbody').children('tr').children('th')
        .filter(function () {
          return $(this).text() === VA;
        }).parent().children('td').children('a').each(function () {
          const vaName = normalizeVoiceActorName($(this).text());
          if (!vaName) return;
          work.vas.push({
            name: vaName
          });
        });

      if (work.tags.length === 0 && work.vas.length === 0) {
        reject(isDlsiteChallengeResponse(data)
          ? dlsiteBlockedError('DLsite returned a challenge page.')
          : new Error('Couldn\'t parse data from DLsite work page.'));
      } else {
        resolve(work);
      }
    })
    .catch((error) => {
      if (error.response) {
        // 请求已发出，但服务器响应的状态码不在 2xx 范围内
        reject(requestError(error, url, 'Couldn\'t request work page HTML'));
      } else {
        reject(error);
      }
    });
});

/**
 * 从 public product.json 抓取静态元数据。
 * @param {number} id Work id.
 */
const scrapeProductWorkMetadataFromDLsite = (id) => new Promise((resolve, reject) => {
  const rjLabel = formatRJLabel(id);
  // product.json 只稳定提供日文和英文元数据；中文标签由分类页同步到 t_tag。
  const url = `https://www.dlsite.com/maniax/api/=/product.json?workno=${rjLabel}&locale=ja_JP`;

  axios.retryGet(url, { retry: {} })
    .then((response) => {
      if (typeof response.data === 'string' && /^\s*</.test(response.data)) {
        throw dlsiteBlockedError('DLsite product API returned HTML instead of JSON.');
      }
      const item = Array.isArray(response.data) ? response.data[0] : response.data;
      if (!item || typeof item !== 'object') {
        throw new Error(`Couldn't parse data from DLsite product API for ${rjLabel}.`);
      }

      const rawTitle = item.work_name || item.work_name_masked ||
        item.product_name || item.alt_name;
      const title = typeof rawTitle === 'string'
        ? rawTitle.trim().replace(/ \[.+\] \| DLsite$/, '')
        : '';
      const circleIdMatch = String(item.maker_id || item.circle_id || '').match(/\d+/);
      const circleId = circleIdMatch ? parseInt(circleIdMatch[0], 10) : null;
      const rawCircleName = item.maker_name || item.circle_name || item.maker_name_en;
      const circleName = typeof rawCircleName === 'string'
        ? rawCircleName.trim()
        : '';

      if (!title) {
        throw new Error(`Couldn't find a work title in DLsite product API response for ${rjLabel}.`);
      }
      if (!circleId || !circleName) {
        throw new Error(`Couldn't find a circle in DLsite product API response for ${rjLabel}.`);
      }

      const ageCategory = typeof item.age_category_string === 'string'
        ? item.age_category_string.trim().toLowerCase()
        : '';
      const numericAgeCategory = Number(item.age_category);
      const nsfw = ageCategory
        ? ageCategory === 'adult' || ageCategory === 'r18'
        : (Number.isFinite(numericAgeCategory) ? numericAgeCategory === 3 : true);

      const releaseMatch = typeof (item.release_date || item.regist_date) === 'string'
        ? (item.release_date || item.regist_date).match(/^\d{4}-\d{2}-\d{2}/)
        : null;
      const release = releaseMatch ? releaseMatch[0] : '';

      const genres = Array.isArray(item.genres)
        ? item.genres
        : (Array.isArray(item.genres_replaced) ? item.genres_replaced : []);
      const seenTagIds = new Set();
      const tags = [];
      for (const genre of genres) {
        const tagId = Number(genre.id || genre.search_val);
        if (!Number.isFinite(tagId) || seenTagIds.has(tagId)) continue;

        seenTagIds.add(tagId);
        tags.push({ id: tagId });
      }

      const voiceBy = item.creaters && Array.isArray(item.creaters.voice_by)
        ? item.creaters.voice_by
        : [];
      const seenVaNames = new Set();
      const vas = [];
      for (const va of voiceBy) {
        const vaName = normalizeVoiceActorName(va.name);
        if (!vaName || seenVaNames.has(vaName)) continue;

        seenVaNames.add(vaName);
        vas.push({ name: vaName });
      }

      const detail = item.rate_count_detail;
      let rateCountDetail;
      if (Array.isArray(detail)) {
        rateCountDetail = [1, 2, 3, 4, 5].map((point) => {
          const entry = detail.find(value => Number(value.review_point) === point) || {};
          return {
            review_point: point,
            count: Number(entry.count) || 0,
            ratio: Number(entry.ratio) || 0
          };
        });
      } else {
        const counts = [1, 2, 3, 4, 5].map(point => {
          if (!detail || typeof detail !== 'object') return 0;
          return Number(detail[point] || detail[String(point)]) || 0;
        });
        const total = counts.reduce((sum, count) => sum + count, 0);
        rateCountDetail = counts.map((count, index) => ({
          review_point: index + 1,
          count,
          ratio: total ? Math.floor(count / total * 100) : 0
        }));
      }

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

        const rankDateMatch = typeof item[dateField] === 'string'
          ? item[dateField].match(/^\d{4}-\d{2}-\d{2}/)
          : null;
        ranks.push({
          term,
          category: 'all',
          rank,
          rank_date: rankDateMatch ? rankDateMatch[0] : ''
        });
      }

      const work = {
        id,
        title,
        circle: { id: circleId, name: circleName },
        nsfw,
        release,
        tags,
        vas,
        rate_count: rateCount,
        rate_average_2dp: rateAverage,
        rate_count_detail: rateCountDetail,
        rank: ranks.length ? ranks : null
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

      const seriesIdMatch = String(item.series_id || '').match(/\d+/);
      if (seriesIdMatch && item.series_name) {
        work.series = {
          id: parseInt(seriesIdMatch[0], 10),
          name: item.series_name
        };
      }

      return work;
    })
    .then(resolve)
    .catch((error) => {
      if (error.response) {
        // 请求已发出，但服务器响应的状态码不在 2xx 范围内
        reject(requestError(error, url, 'Couldn\'t request DLsite product API'));
      } else {
        reject(error);
      }
    });
});

/**
 * 抓取 DLsite 分类页中的全量标签目录。
 * 页面会按 locale 返回官方本地化名称，适合按标签 ID 合并后落库。
 * @param {String} locale DLsite locale，例如 zh-cn、zh-tw、ja-jp
 * @returns {Promise<Map<number, string>>}
 */
const scrapeTagListFromDLsite = async (locale) => {
  const url = `https://www.dlsite.com/maniax/genre/list/?locale=${encodeURIComponent(locale)}`;
  const response = await axios.retryGet(url, {
    retry: {},
    headers: { "cookie": `locale=${locale}` }
  });

  if (typeof response.data !== 'string') {
    throw new Error(`Couldn't parse DLsite tag catalog for ${locale}.`);
  }

  const $ = cheerio.load(response.data);
  const tags = new Map();
  $('.versatility_linklist_item a[href*="/works/genre/=/genre/"]').each(function () {
    const tagUrl = $(this).attr('href') || '';
    const tagIdMatch = tagUrl.match(/\/genre\/(\d+)/);
    const tagId = tagIdMatch ? Number(tagIdMatch[1]) : NaN;
    const tagName = $(this).text()
      .trim()
      .replace(/\s*\(\d[\d,]*\)$/, '')
      .trim();
    if (!Number.isInteger(tagId) || tagId <= 0 || !tagName || tags.has(tagId)) return;
    tags.set(tagId, tagName);
  });

  if (tags.size === 0) {
    throw isDlsiteChallengeResponse(response.data)
      ? dlsiteBlockedError(`DLsite returned a challenge page for ${locale} tags.`)
      : new Error(`Couldn't parse any DLsite tags for ${locale}.`);
  }
  return tags;
};

/**
 * 依次抓取三种语言并返回 t_tag 使用的翻译行。
 * @returns {Promise<Array<{id: number, locale: string, name: string}>>}
 */
const scrapeTagCatalogFromDLsite = async () => {
  const catalog = [];
  for (const locale of TAG_CATALOG_LANGUAGES) {
    const tags = await scrapeTagListFromDLsite(locale);
    for (const [id, name] of tags) {
      catalog.push({ id, locale, name });
    }
  }
  return catalog.sort((left, right) => (
    left.id - right.id || left.locale.localeCompare(right.locale)
  ));
};

/**
 * Requests dynamic work metadata from public DLsite API.
 * @param {number} id Work id.
 */
const scrapeDynamicWorkMetadataFromDLsite = id => new Promise((resolve, reject) => {
  const rjLabel = formatRJLabel(id);
  const url = `https://www.dlsite.com/maniax-touch/product/info/ajax?product_id=${rjLabel}`;

  axios.retryGet(url, { retry: {} })
    .then((response) => {
      if (typeof response.data === 'string' && /^\s*</.test(response.data)) {
        throw dlsiteBlockedError('DLsite dynamic API returned HTML instead of JSON.');
      }
      const data = response.data && response.data[rjLabel];
      if (!data) {
        throw new Error(`DLsite dynamic API returned no data for ${rjLabel}.`);
      }
      return data;
    })
    .then((data) => {
      const work = {};
      if (data.dl_count !== undefined) work.dl_count = data.dl_count || "0"; // 售出数
      if (data.rate_average_2dp !== undefined) work.rate_average_2dp = data.rate_average_2dp || 0.0; // 平均评价
      if (data.rate_count !== undefined) work.rate_count = data.rate_count || 0; // 评价数量
      if (data.rate_count_detail !== undefined) work.rate_count_detail = data.rate_count_detail; // 评价分布明细
      if (data.review_count !== undefined) work.review_count = data.review_count; // 评论数量
      if (data.price !== undefined) work.price = data.price; // 价格
      if (Array.isArray(data.rank) && data.rank.length) {
        work.rank = data.rank; // 成绩
      }
      resolve(work);
    })
    .catch((error) => {
      if (error.response) {
        // 请求已发出，但服务器响应的状态码不在 2xx 范围内
        reject(requestError(error, url, 'Couldn\'t request DLsite dynamic API'));
      } else {
        reject(error);
      }
    });
});

/**
 * 用 HVDB 补全 DLsite 元数据中缺失的声优信息。
 * 已下架作品可能没有声优数据，HVDB 失败时不能中断整条扫描记录。
 * @param {number} id Work id.
 * @param {Object} work Parsed DLsite metadata.
 */
const fillMissingVasFromHVDB = async (id, work) => {
  if (work.vas && work.vas.length) return work;

  const rjLabel = formatRJLabel(id);
  try {
    const metadata = await scrapeWorkMetadataFromHVDB(id);
    if (metadata.vas.length <= 1) {
      work.vas = metadata.vas;
    } else {
      // 过滤掉英文的声优名
      metadata.vas.forEach((va) => {
        if (!hasLetter(va.name)) {
          work.vas.push(va);
        }
      });
    }
  } catch (error) {
    console.warn(`[${rjLabel}] HVDB 声优补全失败，保留 DLsite 数据: ${error.message}`);
  }

  return work;
};

/**
 * Scrapes work metadata from DLsite.
 * @param {number} id Work id.
 * @param {Object} options { source: 'product' | 'html' }，默认使用 product.json
 */
const scrapeWorkMetadataFromDLsite = (id, options = {}) => {
  const rjLabel = formatRJLabel(id);
  const source = options.source || STATIC_METADATA_SOURCES.PRODUCT;
  let scrapeStaticMetadata;

  switch (source) {
    case STATIC_METADATA_SOURCES.PRODUCT:
      scrapeStaticMetadata = scrapeProductWorkMetadataFromDLsite;
      break;
    case STATIC_METADATA_SOURCES.HTML:
      scrapeStaticMetadata = scrapeHtmlWorkMetadataFromDLsite;
      break;
    default:
      return Promise.reject(new Error(`Unknown DLsite metadata source: ${source}.`));
  }

  return scrapeStaticMetadata(id)
    .then(staticMetadata => scrapeDynamicWorkMetadataFromDLsite(id)
      .catch((error) => {
        if (isDlsiteBlockedError(error)) throw error;
        // 动态接口只负责补充销量/评论等字段，失败时继续使用静态数据。
        console.warn(`[${rjLabel}] DLsite 动态元数据抓取失败，继续使用静态数据: ${error.message}`);
        return {};
      })
      .then(dynamicMetadata => Object.assign({}, staticMetadata, dynamicMetadata)))
    .then(work => fillMissingVasFromHVDB(id, work));
};


module.exports = {
  scrapeWorkMetadataFromDLsite,
  scrapeHtmlWorkMetadataFromDLsite,
  scrapeProductWorkMetadataFromDLsite,
  scrapeTagListFromDLsite,
  scrapeTagCatalogFromDLsite,
  isDlsiteBlockedError,
  isDlsiteChallengeResponse
};
