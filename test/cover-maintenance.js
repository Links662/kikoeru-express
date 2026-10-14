// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const Jimp = require('jimp');

const scraperAxios = require('../scraper/axios');
const { config } = require('../config');
const {
  coverFilePath,
  isUsableCoverFile,
  readCoverOrigin,
  markCoverAsGenerated,
  getFileStamp,
  COVER_TYPES
} = require('../filesystem/utils');
// 注意：这里加载 scannerModules 只是拿封面维护逻辑，它的数据库连接是懒加载的，测试里不会碰数据库
const {
  generateCoverFromMain,
  planCoverMaintenance,
  maintainCovers,
  upgradeCovers
} = require('../filesystem/scannerModules');

const WORK_ID = 300650;
const RJCODE = '300650';
const DAY = 24 * 60 * 60 * 1000;
const originalCoverFolderDir = config.coverFolderDir;
const originalUpgradeTypes = config.coverUpgradeTypes;
const originalUpgradeInterval = config.coverUpgradeIntervalDays;
const originalRetryGet = scraperAxios.retryGet;

const makeJpeg = (color, width, height) => new Jimp(width, height, color).getBufferAsync(Jimp.MIME_JPEG);

// 打桩 DLsite 图片下载：download 为 null 时模拟失败
let download = null;
const stubDownload = (buffer) => {
  download = buffer;
  scraperAxios.retryGet = async () => {
    if (!download) throw new Error('模拟下载失败');
    return { status: 200, data: Readable.from([download]), config: {} };
  };
};

describe('cover maintenance', function () {
  let tempDir;
  let mainJpeg;
  let samJpeg;

  before(async function () {
    mainJpeg = await makeJpeg(0xff0000ff, 560, 420);
    samJpeg = await makeJpeg(0x0000ffff, 100, 100);
  });

  beforeEach(function () {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kikoeru-covers-'));
    config.coverFolderDir = tempDir;
    config.coverUpgradeTypes = ['sam'];
    config.coverUpgradeIntervalDays = 7;
  });

  afterEach(function () {
    config.coverFolderDir = originalCoverFolderDir;
    config.coverUpgradeTypes = originalUpgradeTypes;
    config.coverUpgradeIntervalDays = originalUpgradeInterval;
    scraperAxios.retryGet = originalRetryGet;
    download = null;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const writeCovers = (types = COVER_TYPES) => {
    for (const type of types) {
      fs.writeFileSync(coverFilePath(RJCODE, type), type === 'main' ? mainJpeg : samJpeg);
    }
  };

  describe('origin marker', function () {
    it('is absent on a downloaded cover', function () {
      writeCovers(['main']);

      expect(readCoverOrigin(coverFilePath(RJCODE, 'main'))).to.equal(null);
    });

    it('survives inside the jpeg without breaking it', async function () {
      writeCovers(['main']);
      const before = fs.readFileSync(coverFilePath(RJCODE, 'main'));
      const meta = { from: 'main', mainSize: 123, mainMtime: 456, at: 789, tried: null };

      await markCoverAsGenerated(coverFilePath(RJCODE, 'main'), meta);

      const after = fs.readFileSync(coverFilePath(RJCODE, 'main'));
      // 标记只往文件头插一个注释段，图像数据原样保留（所以画质不受影响）
      expect(after.length).to.be.greaterThan(before.length);
      expect(after.subarray(after.indexOf(before.subarray(2)))).to.deep.equal(before.subarray(2));
      expect(readCoverOrigin(coverFilePath(RJCODE, 'main'))).to.deep.equal(meta);

      const image = await Jimp.read(coverFilePath(RJCODE, 'main'));
      expect(`${image.bitmap.width}x${image.bitmap.height}`).to.equal('560x420');
      expect(isUsableCoverFile(coverFilePath(RJCODE, 'main'))).to.equal(true);
    });

    it('does not stack up when written twice', async function () {
      writeCovers(['main']);
      const meta = { from: 'main', mainSize: 1, mainMtime: 2, at: 3, tried: null };

      await markCoverAsGenerated(coverFilePath(RJCODE, 'main'), meta);
      await markCoverAsGenerated(coverFilePath(RJCODE, 'main'), Object.assign({}, meta, { tried: 99 }));

      const marked = fs.readFileSync(coverFilePath(RJCODE, 'main'));
      const marker = Buffer.from('kikoeru-origin:');
      // 只应存在一个标记段
      expect(marked.indexOf(marker, marked.indexOf(marker) + 1)).to.equal(-1);
      expect(readCoverOrigin(coverFilePath(RJCODE, 'main')).tried).to.equal(99);
    });
  });

  describe('planCoverMaintenance', function () {
    it('reports nothing to do when covers are downloaded originals', function () {
      writeCovers();

      expect(planCoverMaintenance(RJCODE)).to.deep.equal({ missing: [], stale: [], upgradable: [] });
    });

    it('marks a locally generated cover as upgradable', async function () {
      writeCovers();
      await generateCoverFromMain(RJCODE, 'sam');

      expect(planCoverMaintenance(RJCODE).upgradable).to.deep.equal(['sam']);
      expect(readCoverOrigin(coverFilePath(RJCODE, 'sam')).from).to.equal('main');
    });

    it('waits out the retry interval before trying again', async function () {
      writeCovers();
      await generateCoverFromMain(RJCODE, 'sam');
      await markCoverAsGenerated(coverFilePath(RJCODE, 'sam'), {
        from: 'main',
        mainSize: getFileStamp(coverFilePath(RJCODE, 'main')).size,
        mainMtime: getFileStamp(coverFilePath(RJCODE, 'main')).mtime,
        at: Date.now(),
        tried: Date.now()
      });

      expect(planCoverMaintenance(RJCODE).upgradable).to.deep.equal([]);

      await markCoverAsGenerated(coverFilePath(RJCODE, 'sam'), {
        from: 'main',
        mainSize: getFileStamp(coverFilePath(RJCODE, 'main')).size,
        mainMtime: getFileStamp(coverFilePath(RJCODE, 'main')).mtime,
        at: Date.now() - 30 * DAY,
        tried: Date.now() - 8 * DAY
      });

      expect(planCoverMaintenance(RJCODE).upgradable).to.deep.equal(['sam']);
    });

    it('regenerates covers whose source main has changed', async function () {
      writeCovers();
      await generateCoverFromMain(RJCODE, 'sam');

      // main 换成了另一张（大小/时间都变了）
      fs.writeFileSync(coverFilePath(RJCODE, 'main'), await makeJpeg(0x00ff00ff, 480, 360));

      const plan = planCoverMaintenance(RJCODE);
      expect(plan.stale).to.deep.equal(['sam']);
      expect(plan.upgradable).to.deep.equal([]);
    });

    it('treats every existing type as upgradable with refreshAllCovers', function () {
      writeCovers();

      const plan = planCoverMaintenance(RJCODE, { refreshAllCovers: true });
      expect(plan.upgradable).to.deep.equal(COVER_TYPES);
    });
  });

  describe('maintainCovers', function () {
    it('skips works whose covers need nothing', async function () {
      writeCovers();

      expect(await maintainCovers(WORK_ID, RJCODE)).to.equal('skipped');
      expect(await maintainCovers(WORK_ID, RJCODE, { dryRun: true })).to.equal('skipped');
    });

    it('reports what it would do in dry run without touching anything', async function () {
      writeCovers(['main']);

      expect(await maintainCovers(WORK_ID, RJCODE, { dryRun: true })).to.equal('pending');
      expect(fs.existsSync(coverFilePath(RJCODE, 'sam'))).to.equal(false);
    });

    it('regenerates stale covers from main without using the network', async function () {
      writeCovers();
      await generateCoverFromMain(RJCODE, 'sam');
      fs.writeFileSync(coverFilePath(RJCODE, 'main'), await makeJpeg(0x00ff00ff, 480, 360));
      stubDownload(null);

      expect(await maintainCovers(WORK_ID, RJCODE)).to.equal('repaired');

      const image = await Jimp.read(coverFilePath(RJCODE, 'sam'));
      expect(`${image.bitmap.width}x${image.bitmap.height}`).to.equal('100x75');
    });

    it('keeps the generated cover and remembers the attempt when the upgrade fails', async function () {
      writeCovers();
      await generateCoverFromMain(RJCODE, 'sam');
      stubDownload(null);

      expect(await maintainCovers(WORK_ID, RJCODE)).to.equal('skipped');

      const origin = readCoverOrigin(coverFilePath(RJCODE, 'sam'));
      expect(origin.tried).to.be.a('number');
      expect(isUsableCoverFile(coverFilePath(RJCODE, 'sam'))).to.equal(true);
    });

    it('replaces the generated cover with the DLsite original once the download works', async function () {
      writeCovers();
      await generateCoverFromMain(RJCODE, 'sam');
      // 上次尝试已经是 8 天前
      await markCoverAsGenerated(coverFilePath(RJCODE, 'sam'), Object.assign(
        {},
        readCoverOrigin(coverFilePath(RJCODE, 'sam')),
        { tried: Date.now() - 8 * DAY }
      ));
      stubDownload(samJpeg);

      expect(await maintainCovers(WORK_ID, RJCODE)).to.equal('upgraded');

      expect(fs.readFileSync(coverFilePath(RJCODE, 'sam'))).to.deep.equal(samJpeg);
      // 换成原图后标记消失，之后不会再被当成降级图
      expect(readCoverOrigin(coverFilePath(RJCODE, 'sam'))).to.equal(null);
      expect(planCoverMaintenance(RJCODE).upgradable).to.deep.equal([]);
    });

    it('reports failure when refreshAllCovers could not download', async function () {
      writeCovers();
      stubDownload(null);

      expect(await maintainCovers(WORK_ID, RJCODE, { refreshAllCovers: true })).to.equal('failed');
    });

    it('upgradeCovers keeps working through a download of several types', async function () {
      writeCovers(['main']);
      stubDownload(samJpeg);

      const { upgraded, failed } = await upgradeCovers(WORK_ID, RJCODE, ['sam', '240x240']);

      expect(upgraded).to.equal(2);
      expect(failed).to.equal(0);
    });
  });
});
