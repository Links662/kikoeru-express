// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const path = require('path');

const scraperAxios = require('../scraper/axios');
const {
  scrapeProductWorkMetadataFromDLsite,
  scrapeWorkMetadataFromDLsite
} = require('../scraper/dlsite');

const loadFixture = name => JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
);

const scrapeProductFixture = async (name, id, language = 'ja-JP') => {
  scraperAxios.retryGet = async () => ({ data: loadFixture(name) });
  return scrapeProductWorkMetadataFromDLsite(id, language);
};

describe('DLsite metadata scraping', function () {
  const originalRetryGet = scraperAxios.retryGet;

  afterEach(function () {
    scraperAxios.retryGet = originalRetryGet;
  });

  it('requests product.json with the configured locale', async function () {
    const calls = [];
    scraperAxios.retryGet = async (url) => {
      calls.push(url);
      return { data: loadFixture('dlsite-product-rj01171233.json') };
    };

    await scrapeProductWorkMetadataFromDLsite(1171233, 'ja-JP');

    expect(calls).to.deep.equal([
      'https://www.dlsite.com/maniax/api/=/product.json?workno=RJ01171233&locale=ja-JP'
    ]);
  });

  it('rejects a tag language outside the configured values', async function () {
    scraperAxios.retryGet = async () => {
      throw new Error('request should not be sent with an invalid locale');
    };

    let error;
    try {
      await scrapeProductWorkMetadataFromDLsite(1171233, 'ja-jp');
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an('error');
    expect(error.message).to.equal('Unsupported DLsite tag language: ja-jp.');
  });

  it('maps title, circle, tags, voice actors and release date', async function () {
    const work = await scrapeProductFixture('dlsite-product-rj01171233.json', 1171233);

    expect(work.title).to.equal('NoTitle');
    expect(work.circle).to.deep.equal({ id: 62782, name: 'つばめいと' });
    expect(work.nsfw).to.equal(true);
    expect(work.release).to.equal('2024-04-01');
    expect(work.tags).to.have.length(7);
    expect(work.tags[0]).to.deep.equal({ id: 497, name: 'ASMR' });
    expect(work.vas.map(va => va.name)).to.deep.equal(['柚木つばめ']);
  });

  it('maps price, rating distribution and rank fields', async function () {
    const work = await scrapeProductFixture('dlsite-product-rj01171233.json', 1171233);

    expect(work.price).to.equal(550);
    expect(work.rate_count).to.equal(3264);
    expect(work.rate_average_2dp).to.equal(4.83);
    expect(work.rate_count_detail.map(detail => detail.count))
      .to.deep.equal([3, 18, 96, 299, 2848]);
    expect(work.rate_count_detail.map(detail => detail.ratio))
      .to.deep.equal([0, 0, 2, 9, 87]);
    expect(work.rank).to.deep.include({
      term: 'day',
      category: 'all',
      rank: 2,
      rank_date: '2024-04-02'
    });
    expect(work.rank.find(entry => entry.term === 'total').rank).to.equal(1170);
  });

  it('maps discounted prices and multiple tags from another response', async function () {
    const work = await scrapeProductFixture('dlsite-product-rj01732076.json', 1732076);

    expect(work.title).to.equal(
      '【オホ声】絶対にヤッてはいけない地雷系サークルクラッシャーちゃん～濃厚ザーメンで子作り共依存エッチ♡～'
    );
    expect(work.circle).to.deep.equal({ id: 65974, name: '永井監督' });
    expect(work.tags).to.have.length(8);
    expect(work.vas.map(va => va.name)).to.deep.equal(['陽向葵ゅか']);
    expect(work.price).to.equal(990);
    expect(work.rate_count).to.equal(3);
    expect(work.rate_average_2dp).to.equal(5);
    expect(work.rank.find(entry => entry.term === 'week').rank).to.equal(146);
  });

  it('maps adult and all-ages product categories', async function () {
    const item = loadFixture('dlsite-product-rj01171233.json')[0];
    scraperAxios.retryGet = async () => ({ data: [{
      ...item,
      age_category: 1,
      age_category_string: 'all'
    }] });
    const allAges = await scrapeProductWorkMetadataFromDLsite(1171233, 'ja-JP');

    scraperAxios.retryGet = async () => ({ data: [{
      ...item,
      age_category: 3,
      age_category_string: 'adult'
    }] });
    const adult = await scrapeProductWorkMetadataFromDLsite(1171233, 'ja-JP');

    expect(allAges.nsfw).to.equal(false);
    expect(adult.nsfw).to.equal(true);

    scraperAxios.retryGet = async () => ({ data: [{
      ...item,
      age_category: undefined,
      age_category_string: undefined
    }] });
    const unknown = await scrapeProductWorkMetadataFromDLsite(1171233, 'ja-JP');
    expect(unknown.nsfw).to.equal(true);
  });

  it('keeps delisted works when optional fields are missing', async function () {
    const item = loadFixture('dlsite-product-rj01171233.json')[0];
    scraperAxios.retryGet = async () => ({ data: [{
      ...item,
      on_sale: 0,
      price: 0,
      creaters: null,
      genres: [],
      rate_count_detail: null,
      rank_day: null,
      rank_week: null,
      rank_month: null,
      rank_year: null,
      rank_total: null
    }] });
    const work = await scrapeProductWorkMetadataFromDLsite(1171233, 'ja-JP');

    expect(work.title).to.equal('NoTitle');
    expect(work.circle).to.deep.equal({ id: 62782, name: 'つばめいと' });
    expect(work.vas).to.deep.equal([]);
    expect(work.tags).to.deep.equal([]);
    expect(work.rate_count).to.equal(0);
    expect(work.rate_average_2dp).to.equal(0);
    expect(work.rank).to.equal(null);
  });

  it('accepts an object response as well as the usual array', async function () {
    const item = loadFixture('dlsite-product-rj01171233.json')[0];
    scraperAxios.retryGet = async () => ({ data: item });
    const work = await scrapeProductWorkMetadataFromDLsite(1171233, 'ja-JP');

    expect(work.title).to.equal('NoTitle');
    expect(work.circle.id).to.equal(62782);
  });

  it('uses product.json by default and merges optional dynamic statistics', async function () {
    const calls = [];
    scraperAxios.retryGet = async (url) => {
      calls.push(url);
      if (url.includes('/work/=/product_id/')) {
        throw new Error('legacy page must not be requested');
      }
      if (url.startsWith('https://www.dlsite.com/maniax/api/=')) {
        return { data: loadFixture('dlsite-product-rj01171233.json') };
      }
      if (url.includes('product/info/ajax')) {
        return {
          data: {
            RJ01171233: {
              dl_count: 1234,
              review_count: 12,
              price: 550
            }
          }
        };
      }
      throw new Error('unexpected request');
    };

    const work = await scrapeWorkMetadataFromDLsite(1171233, 'ja-JP');

    expect(calls).to.include(
      'https://www.dlsite.com/maniax/api/=/product.json?workno=RJ01171233&locale=ja-JP'
    );
    expect(calls.some(url => url.includes('/work/=/product_id/'))).to.equal(false);
    expect(work.title).to.equal('NoTitle');
    expect(work.release).to.equal('2024-04-01');
    expect(work.dl_count).to.equal(1234);
    expect(work.review_count).to.equal(12);
  });

  it('does not fall back to the legacy page when product.json fails', async function () {
    const calls = [];
    scraperAxios.retryGet = async (url) => {
      calls.push(url);
      if (url.startsWith('https://www.dlsite.com/maniax/api/=')) {
        throw new Error('product API unavailable');
      }
      throw new Error('unexpected legacy page request');
    };

    let error;
    try {
      await scrapeWorkMetadataFromDLsite(1171233, 'ja-JP');
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an('error');
    expect(error.message).to.equal('product API unavailable');
    expect(calls.some(url => url.includes('/work/=/product_id/'))).to.equal(false);
  });

  it('keeps a delisted work when dynamic and HVDB enrichment fail', async function () {
    const item = loadFixture('dlsite-product-rj01171233.json')[0];
    scraperAxios.retryGet = async (url) => {
      if (url.includes('/work/=/product_id/')) {
        throw new Error('legacy page unavailable');
      }
      if (url.startsWith('https://www.dlsite.com/maniax/api/=')) {
        return {
          data: [{
            ...item,
            on_sale: 0,
            creaters: null
          }]
        };
      }
      throw new Error('not available');
    };

    const work = await scrapeWorkMetadataFromDLsite(1171233, 'zh-CN');

    expect(work.title).to.equal('NoTitle');
    expect(work.vas).to.deep.equal([]);
    expect(work.tags).to.have.length(7);
  });

  it('keeps the legacy HTML parser available as an explicit mode', async function () {
    const legacyPage = `
      <html>
        <head>
          <meta property="og:title" content="NoTitle [つばめいと] | DLsite">
        </head>
        <body>
          <span class="maker_name">
            <a href="https://www.dlsite.com/maniax/circle/profile/=/maker_id/RG62782.html">つばめいと</a>
          </span>
          <table id="work_outline"><tbody>
            <tr><th>年齢指定</th><td><span>R18</span></td></tr>
            <tr><th>販売日</th><td>2024年04月01日</td></tr>
            <tr><th>ジャンル</th><td><div>
              <a href="https://www.dlsite.com/maniax/fsr/=/genre/497/from/work.genre">ASMR</a>
            </div></td></tr>
            <tr><th>声優</th><td><a>柚木つばめ</a></td></tr>
          </tbody></table>
        </body>
      </html>
    `;
    const calls = [];
    scraperAxios.retryGet = async (url) => {
      calls.push(url);
      if (url.includes('/work/=/product_id/')) {
        return { data: legacyPage };
      }
      if (url.includes('product/info/ajax')) {
        return {
          data: {
            RJ01171233: {
              dl_count: 1234
            }
          }
        };
      }
      throw new Error('unexpected request');
    };

    const work = await scrapeWorkMetadataFromDLsite(1171233, 'ja-JP', { source: 'html' });

    expect(work.title).to.equal('NoTitle');
    expect(work.tags).to.deep.equal([{ id: 497, name: 'ASMR' }]);
    expect(work.vas.map(va => va.name)).to.deep.equal(['柚木つばめ']);
    expect(calls.some(url => url.includes('product.json'))).to.equal(false);
  });
});
