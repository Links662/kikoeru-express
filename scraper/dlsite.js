const cheerio = require('cheerio');

const axios = require('./axios');
const {
  nameToUUID,
  hasLetter,
  nsfwFromAgeRating
} = require('./utils');
const scrapeWorkMetadataFromHVDB = require('./hvdb');
const { scrapeWorkMetadataFromDLsiteProduct } = require('./dlsiteProduct');
const { formatRJLabel } = require('../utils/workId');

const DEFAULT_TAG_LANGUAGE = 'zh-cn';

/**
 * Scrapes static work metadata from public DLsite page HTML.
 * @param {number} id Work id.
 * @param {String} language 标签语言，'ja-jp', 'zh-tw' or 'zh-cn'，默认'zh-cn'
 */
const scrapeHtmlWorkMetadataFromDLsite = (id, language) => new Promise((resolve, reject) => {
  const rjLabel = formatRJLabel(id);
  const url = `https://www.dlsite.com/maniax/work/=/product_id/${rjLabel}.html`;
  const normalizedLanguage = typeof language === 'string' && language.trim()
    ? language.trim().toLowerCase()
    : DEFAULT_TAG_LANGUAGE;

  // 抓源缺少年龄字段时按 R18 处理，保证交给持久层的元数据字段完整。
  const work = { id, nsfw: true, tags: [], vas: [] };
  let AGE_RATINGS, VA, GENRE, RELEASE, SERIES, COOKIE_LOCALE;
  switch (normalizedLanguage) {
    case 'ja-jp':
      COOKIE_LOCALE = 'locale=ja-jp';
      AGE_RATINGS = '年齢指定';
      GENRE = 'ジャンル';
      VA = '声優';
      RELEASE = '販売日';
      SERIES = 'シリーズ名';
      break;
    case 'zh-tw':
      COOKIE_LOCALE = 'locale=zh-tw';
      AGE_RATINGS = '年齡指定';
      GENRE = '分類';
      VA = '聲優';
      RELEASE = '販賣日';
      SERIES = '系列名';
      break;
    default:
      COOKIE_LOCALE = 'locale=zh-cn';
      AGE_RATINGS = '年龄指定';
      GENRE = '分类';
      VA = '声优';
      RELEASE = '贩卖日';
      SERIES = '系列名';
  }

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
          const tagName = $(this).text();
          if (tagUrl.match(/genre\/(\d{3})/)) {
            work.tags.push({
              id: parseInt(tagUrl.match(/genre\/(\d{3})/)[1]),
              name: tagName
            });
          }
        });

      // 声优
      workOutline.children('tbody').children('tr').children('th')
        .filter(function () {
          return $(this).text() === VA;
        }).parent().children('td').children('a').each(function () {
          const vaName = $(this).text().trim();
          work.vas.push({
            id: nameToUUID(vaName),
            name: vaName
          });
        });

      if (work.tags.length === 0 && work.vas.length === 0) {
        reject(new Error('Couldn\'t parse data from DLsite work page.'));
      } else {
        resolve(work);
      }
    })
    .catch((error) => {
      if (error.response) {
        // 请求已发出，但服务器响应的状态码不在 2xx 范围内
        reject(new Error(`Couldn't request work page HTML (${url}), received: ${error.response.status}.`));
      } else {
        reject(error);
      }
    });
});

/**
 * 优先使用旧的作品页 HTML 抓取，失败后再用 product.json 兜底。
 * 这样已下架作品在旧页面不可用时仍然可以写入元数据。
 * @param {number} id Work id.
 * @param {String} language 标签语言，'ja-jp', 'zh-tw' or 'zh-cn'，默认'zh-cn'
 */
const scrapeStaticWorkMetadataFromDLsite = (id, language) => {
  const rjLabel = formatRJLabel(id);

  return scrapeHtmlWorkMetadataFromDLsite(id, language)
    .catch((error) => {
      console.warn(`[${rjLabel}] DLsite 作品页抓取失败，改用 product.json: ${error.message}`);
      return scrapeWorkMetadataFromDLsiteProduct(id, language);
    });
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
      console.log(`[${rjLabel}] 成功从 DLSite 抓取Dynamic元数据...`);
      resolve(work);
    })
    .catch((error) => {
      if (error.response) {
        // 请求已发出，但服务器响应的状态码不在 2xx 范围内
        reject(new Error(`Couldn't request DLsite dynamic API (${url}), received: ${error.response.status}.`));
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
 * Scrapes work metadata from DLsite, preferring the legacy work page.
 * @param {number} id Work id.
 * @param {String} language 标签语言，'ja-jp', 'zh-tw' or 'zh-cn'，默认'zh-cn'
 */
const scrapeWorkMetadataFromDLsite = (id, language) => {
  const rjLabel = formatRJLabel(id);

  return Promise.all([
    scrapeStaticWorkMetadataFromDLsite(id, language),
    scrapeDynamicWorkMetadataFromDLsite(id).catch((error) => {
      // 动态接口只负责补充销量/评论等字段，失败时继续使用静态数据。
      console.warn(`[${rjLabel}] DLsite 动态元数据抓取失败，继续使用静态数据: ${error.message}`);
      return {};
    })
  ])
    .then(([staticMetadata, dynamicMetadata]) => (
      Object.assign({}, staticMetadata, dynamicMetadata)
    ))
    .then(work => fillMissingVasFromHVDB(id, work));
};


module.exports = {
  scrapeWorkMetadataFromDLsite
};
