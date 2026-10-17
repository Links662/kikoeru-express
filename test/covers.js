// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Readable, PassThrough } = require('stream');
const express = require('express');
const Jimp = require('jimp');

const axios = require('../scraper/axios');
const coverRouter = require('../routes/metadata');
const { config } = require('../config');
const {
  saveCoverImageToDisk,
  deleteCoverImageFromDisk,
  removeTemporaryCoverFiles,
  isUsableCoverFile,
  coverFilePath,
  COVER_TYPES,
} = require('../filesystem/utils');

const NO_IMAGE_PATH = path.join(__dirname, '../static/no-image.jpg');
const JPEG = fs.readFileSync(NO_IMAGE_PATH);
const WORK_ID = 300650;
const RJCODE = '300650';
const originalCoverFolderDir = config.coverFolderDir;
// 三种封面用颜色/尺寸都不同的真 JPEG，断言降级顺序时才能分辨到底返回了哪一张
const makeJpeg = (color, width, height) => new Jimp(width, height, color).getBufferAsync(Jimp.MIME_JPEG);
let MAIN_JPEG;
let THUMB_JPEG;
let SAM_JPEG;

before(async function () {
  MAIN_JPEG = await makeJpeg(0xff0000ff, 560, 420);
  THUMB_JPEG = await makeJpeg(0x00ff00ff, 240, 180);
  SAM_JPEG = await makeJpeg(0x0000ffff, 100, 75);
});
// 测试里起的 http 服务统一登记，避免某个用例失败后 mocha 因为句柄没关而不退出
const openServers = [];
const closeServers = () => {
  while (openServers.length) openServers.pop().close();
};

const expectRejection = async (promise) => {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
};

// 发完响应头、只写一部分响应体就断开连接：复现下载封面过程中的网络中断
const startTruncatedImageServer = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': `${JPEG.length + 100000}` });
    res.write(JPEG);
    setTimeout(() => res.socket.destroy(), 20);
  });

  server.listen(0, '127.0.0.1', () => {
    openServers.push(server);
    resolve({
      server,
      url: `http://127.0.0.1:${server.address().port}/RJ${RJCODE}_img_main.jpg`,
    });
  });
});

const startCoverServer = () => new Promise((resolve) => {
  const app = express();
  app.use('/api', coverRouter);

  const server = app.listen(0, '127.0.0.1', () => {
    openServers.push(server);
    resolve({
      server,
      baseUrl: `http://127.0.0.1:${server.address().port}/api/cover/${WORK_ID}`,
    });
  });
});

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

describe('cover helpers', function () {
  let tempDir;

  beforeEach(function () {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kikoeru-covers-'));
    config.coverFolderDir = tempDir;
  });

  afterEach(function () {
    config.coverFolderDir = originalCoverFolderDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
    closeServers();
  });

  it('treats missing, empty and non-jpeg covers as unusable', function () {
    const mainPath = coverFilePath(RJCODE, 'main');

    expect(isUsableCoverFile(mainPath)).to.equal(false);

    fs.writeFileSync(mainPath, '');
    expect(isUsableCoverFile(mainPath)).to.equal(false);

    // DLsite 被拦截时返回的 HTML 错误页
    fs.writeFileSync(mainPath, '<html><body>403 Forbidden</body></html>');
    expect(isUsableCoverFile(mainPath)).to.equal(false);

    fs.writeFileSync(mainPath, JPEG);
    expect(isUsableCoverFile(mainPath)).to.equal(true);
  });

  it('keeps main plus both thumbnails', function () {
    expect(COVER_TYPES).to.deep.equal(['main', 'sam', '240x240']);
  });

  it('accepts the jpegs it is asked to serve', function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'main'), MAIN_JPEG);
    fs.writeFileSync(coverFilePath(RJCODE, 'sam'), SAM_JPEG);

    expect(isUsableCoverFile(coverFilePath(RJCODE, 'main'))).to.equal(true);
    expect(isUsableCoverFile(coverFilePath(RJCODE, 'sam'))).to.equal(true);
  });

  it('writes the cover atomically and leaves no .part file behind', async function () {
    await saveCoverImageToDisk(Readable.from([JPEG]), RJCODE, '240x240');

    expect(fs.readFileSync(coverFilePath(RJCODE, '240x240'))).to.deep.equal(JPEG);
    expect(fs.readdirSync(tempDir)).to.deep.equal([`RJ${RJCODE}_img_240x240.jpg`]);
  });

  it('rejects (instead of hanging) when the response body is cut off mid-transfer', async function () {
    const { server, url } = await startTruncatedImageServer();

    expect(server.listening).to.equal(true);

    const imageRes = await axios.get(url, { responseType: 'stream' });
    // axios 收到响应头就 resolve，响应体完整性只能由 saveCoverImageToDisk 判断
    const err = await expectRejection(saveCoverImageToDisk(imageRes.data, RJCODE, 'main'));

    expect(err).to.be.an('error');
    expect(fs.existsSync(coverFilePath(RJCODE, 'main'))).to.equal(false);
    expect(fs.readdirSync(tempDir)).to.deep.equal([]);
  });

  it('rejects when the source stream errors', async function () {
    const source = new PassThrough();
    const promise = saveCoverImageToDisk(source, RJCODE, 'main');

    source.write(JPEG);
    setTimeout(() => source.destroy(new Error('socket hang up')), 10);

    const err = await expectRejection(promise);

    expect(err && err.message).to.equal('socket hang up');
    expect(fs.existsSync(coverFilePath(RJCODE, 'main'))).to.equal(false);
    expect(fs.readdirSync(tempDir)).to.deep.equal([]);
  });

  it('rejects a response that is not an image without replacing the existing cover', async function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'sam'), JPEG);

    // DLsite 被拦截时可能返回 200 + HTML 错误页
    const err = await expectRejection(
      saveCoverImageToDisk(Readable.from([Buffer.from('<html>403 Forbidden</html>')]), RJCODE, 'sam'),
    );

    expect(err).to.be.an('error');
    expect(err.message).to.equal('下载到的内容不是有效图片');
    // 原来的封面还在，.part 也没留下
    expect(fs.readFileSync(coverFilePath(RJCODE, 'sam'))).to.deep.equal(JPEG);
    expect(fs.readdirSync(tempDir)).to.deep.equal([`RJ${RJCODE}_img_sam.jpg`]);
  });

  it('deletes every cover type of a work, including the missing ones', async function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'main'), JPEG);
    fs.writeFileSync(coverFilePath(RJCODE, '240x240'), JPEG);

    await deleteCoverImageFromDisk(RJCODE);

    expect(fs.readdirSync(tempDir)).to.deep.equal([]);
  });

  it('removes leftover .part files without touching finished covers', async function () {
    fs.writeFileSync(path.join(tempDir, `RJ${RJCODE}_img_main.jpg`), JPEG);
    fs.writeFileSync(path.join(tempDir, `RJ${RJCODE}_img_240x240.jpg.part`), 'partial');

    await removeTemporaryCoverFiles();

    expect(fs.readdirSync(tempDir)).to.deep.equal([`RJ${RJCODE}_img_main.jpg`]);
  });
});

describe('GET /api/cover', function () {
  let tempDir;
  let baseUrl;

  before(async function () {
    ({ baseUrl } = await startCoverServer());
  });

  after(function () {
    closeServers();
  });

  beforeEach(function () {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kikoeru-covers-'));
    config.coverFolderDir = tempDir;
  });

  afterEach(function () {
    config.coverFolderDir = originalCoverFolderDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('serves main for the main type', async function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'main'), MAIN_JPEG);

    const response = await get(`${baseUrl}?type=main`);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal(MAIN_JPEG);
  });

  it('serves sam for the sam type', async function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'sam'), SAM_JPEG);

    const response = await get(`${baseUrl}?type=sam`);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal(SAM_JPEG);
  });

  it('falls back to the thumbnail and then main when sam is missing', async function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'main'), MAIN_JPEG);
    fs.writeFileSync(coverFilePath(RJCODE, '240x240'), THUMB_JPEG);

    const response = await get(`${baseUrl}?type=sam`);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal(THUMB_JPEG);

    fs.unlinkSync(coverFilePath(RJCODE, '240x240'));
    const fallbackToMain = await get(`${baseUrl}?type=sam`);

    expect(fallbackToMain.body).to.deep.equal(MAIN_JPEG);
  });

  it('falls back to main when the 240x240 thumbnail is missing', async function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'main'), MAIN_JPEG);

    const response = await get(`${baseUrl}?type=240x240`);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal(MAIN_JPEG);
  });

  it('maps the legacy sam@2x type to sam', async function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'sam'), SAM_JPEG);

    const response = await get(`${baseUrl}?type=sam@2x`);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal(SAM_JPEG);
  });

  it('falls back to main when the requested cover is empty', async function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'main'), MAIN_JPEG);
    fs.writeFileSync(coverFilePath(RJCODE, '240x240'), '');

    const response = await get(`${baseUrl}?type=240x240`);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal(MAIN_JPEG);
  });

  it('serves the placeholder when every candidate is missing', async function () {
    const response = await get(`${baseUrl}?type=240x240`);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal(fs.readFileSync(NO_IMAGE_PATH));
  });

  it('ignores unknown types instead of building a path from them', async function () {
    fs.writeFileSync(coverFilePath(RJCODE, 'main'), MAIN_JPEG);

    const response = await get(`${baseUrl}?type=${encodeURIComponent('../../evil')}`);

    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal(MAIN_JPEG);
  });
});
