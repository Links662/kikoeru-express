const fs = require('fs');
const Jimp = require('jimp');

const axios = require('../../scraper/axios');
const {
  saveCoverImageToDisk,
  COVER_TYPES,
  coverFilePath,
  isUsableCoverFile,
  readCoverOrigin,
  markCoverAsGenerated,
  getFileStamp
} = require('../utils');
const { formatRJLabel } = require('../../utils/workId');
const { config } = require('../../config');
const reporter = require('./reporter');

const getCoverImage = async (id, types) => {
  const rjLabel = formatRJLabel(id);
  const workLog = reporter.forWork(id);

  // DLsite 的图片按每 1000 个 RJ 号分目录存放
  const id2 = (id % 1000 === 0) ? id : parseInt(id / 1000, 10) * 1000 + 1000;
  const rjLabel2 = formatRJLabel(id2);

  workLog.progress('从 DLsite 下载封面...');

  const succeeded = [];
  const failed = [];

  for (const type of types) {
    let url = `https://img.dlsite.jp/modpub/images2/work/doujin/${rjLabel2}/${rjLabel}_img_${type}.jpg`;
    // 240x240 / 360x360 走 resize 线，其余的（main、sam、sam@2x ...）都是原路径
    if (type === '240x240' || type === '360x360') {
      url = `https://img.dlsite.jp/resize/images2/work/doujin/${rjLabel2}/${rjLabel}_img_main_${type}.jpg`;
    }

    try {
      const imageRes = await axios.retryGet(url, {
        responseType: 'stream',
        retry: {}
      });
      await saveCoverImageToDisk(imageRes.data, id, type);

      workLog.success(`封面 ${rjLabel}_img_${type}.jpg 下载成功.`, {
        type: 'detail'
      });
      succeeded.push(type);
    } catch (err) {
      // 非 2xx 时响应体没有被消费，主动释放，避免批量扫描时一直占着 socket
      if (err.response && err.response.data && err.response.data.destroy) {
        err.response.data.destroy();
      }

      workLog.error(
        `在下载封面 ${rjLabel}_img_${type}.jpg 过程中出错: ${err.message}`,
        { type: 'detail' }
      );
      failed.push(type);
    }
  }

  return { succeeded, failed };
};

/**
 * 可以由 main 派生出来的缩略图规格。
 * 240x240：DLsite 的资产就是 main 的等比缩放，
 *          本地生成与重新下载等价，但不需要联网。
 * sam：DLsite 的 sam 是原图的等比缩略，由 main 生成只用于兜底。
 */
const DERIVED_COVER_SPECS = {
  '240x240': { width: 240, quality: 90 },
  sam: { width: 100, quality: 85 }
};

const markGeneratedCover = async (id, type) => {
  const stamp = getFileStamp(coverFilePath(id, 'main'));

  try {
    await markCoverAsGenerated(coverFilePath(id, type), {
      from: 'main',
      mainSize: stamp ? stamp.size : null,
      mainMtime: stamp ? stamp.mtime : null,
      at: Date.now(),
      tried: null
    });
  } catch (err) {
    // 标记只是以后能升级的依据，写不上不应让整张图白生成
    reporter.forWork(id).error(
      `无法写入 ${type} 的来源标记（将不会自动升级）: ${err.message}`,
      { type: 'detail' }
    );
  }
};

const generateCoverFromMain = async (id, type) => {
  const spec = DERIVED_COVER_SPECS[type];
  if (!spec) return false;
  const workLog = reporter.forWork(id);

  const mainPath = coverFilePath(id, 'main');
  const outputPath = coverFilePath(id, type);
  const tempPath = `${outputPath}.part`;

  try {
    if (!isUsableCoverFile(mainPath)) return false;

    const image = await Jimp.read(mainPath);
    await image.resize(spec.width, Jimp.AUTO)
      .quality(spec.quality)
      .writeAsync(tempPath);
    await fs.promises.rename(tempPath, outputPath);

    // 记下这张图是本地生成的，以后才有机会换成 DLsite 的原图
    await markGeneratedCover(id, type);

    workLog.success(`已由 main 生成 ${type} 缩略图.`, {
      type: 'detail'
    });
    return true;
  } catch (err) {
    await fs.promises.unlink(tempPath).catch(() => {});
    workLog.error(`由 main 生成 ${type} 缩略图失败: ${err.message}`, {
      type: 'detail'
    });
    return false;
  }
};

const markCoverUpgradeAttempt = async (id, type, origin) => {
  try {
    await markCoverAsGenerated(coverFilePath(id, type), Object.assign({}, origin, {
      tried: Date.now()
    }));
  } catch (err) {
    reporter.forWork(id).error(
      `无法记录 ${type} 的升级尝试: ${err.message}`,
      { type: 'detail' }
    );
  }
};

const isGeneratedCoverStale = (id, origin) => {
  const stamp = getFileStamp(coverFilePath(id, 'main'));

  if (!stamp) return false;
  return stamp.size !== origin.mainSize || stamp.mtime !== origin.mainMtime;
};

const isCoverUpgradeDue = (type, origin) => {
  if (!config.coverUpgradeTypes.includes(type)) return false;

  const interval = (config.coverUpgradeIntervalDays || 0) * 24 * 60 * 60 * 1000;
  if (!interval) return true;

  return !origin.tried || Date.now() - origin.tried >= interval;
};

const planCoverMaintenance = (id, options = {}) => {
  const plan = { missing: [], stale: [], upgradable: [] };

  for (const type of COVER_TYPES) {
    const filePath = coverFilePath(id, type);

    if (!isUsableCoverFile(filePath)) {
      plan.missing.push(type);
      continue;
    }

    // 全量重取：连 DLsite 的原图一起重取（怀疑真图损坏时用）
    if (options.refreshAllCovers) {
      plan.upgradable.push(type);
      continue;
    }

    if (!DERIVED_COVER_SPECS[type]) continue; // main 没有派生的概念

    const origin = readCoverOrigin(filePath);
    if (!origin) continue; // DLsite 原图

    if (isGeneratedCoverStale(id, origin)) plan.stale.push(type);
    else if (isCoverUpgradeDue(type, origin)) plan.upgradable.push(type);
  }

  return plan;
};

const describeCoverPlan = (plan) => {
  const parts = [];
  if (plan.missing.length) parts.push(`缺失 ${plan.missing.join('/')}`);
  if (plan.stale.length) parts.push(`需重新生成 ${plan.stale.join('/')}`);
  if (plan.upgradable.length) parts.push(`可升级 ${plan.upgradable.join('/')}`);

  return parts.join('，');
};

const upgradeCovers = async (id, types) => {
  let upgraded = 0;
  let failed = 0;

  for (const type of types) {
    const origin = readCoverOrigin(coverFilePath(id, type));
    const results = await getCoverImage(id, [type]);

    if (results.succeeded.includes(type)) {
      upgraded += 1;
    } else {
      if (origin) await markCoverUpgradeAttempt(id, type, origin);
      failed += 1;
    }
  }

  return { upgraded, failed };
};

const generateMissingThumbnails = async (id, types) => {
  for (const type of types) {
    if (!DERIVED_COVER_SPECS[type]) continue;
    if (isUsableCoverFile(coverFilePath(id, type))) continue;

    await generateCoverFromMain(id, type);
  }
};

const fetchCover = async (id) => {
  await getCoverImage(id, COVER_TYPES);

  if (!isUsableCoverFile(coverFilePath(id, 'main'))) return 'failed';

  await generateMissingThumbnails(id, COVER_TYPES);

  return 'added';
};

const repairCover = async (id, missingTypes) => {
  const workLog = reporter.forWork(id);

  if (missingTypes.includes('main')) {
    workLog.progress(
      `封面图片缺失或损坏，重新下载: ${missingTypes.join(', ')}`
    );
    await getCoverImage(id, missingTypes);

    if (!isUsableCoverFile(coverFilePath(id, 'main'))) return 'failed';
  } else if (missingTypes.includes('sam')) {
    workLog.progress('sam 缩略图缺失，从 DLsite 重新获取...');
    await getCoverImage(id, ['sam']);
  }

  await generateMissingThumbnails(id, missingTypes);
  return 'repaired';
};

const maintainCovers = async (id, options = {}) => {
  const plan = planCoverMaintenance(id, options);
  const workLog = reporter.forWork(id);

  if (!plan.missing.length && !plan.stale.length && !plan.upgradable.length) {
    return 'skipped';
  }

  if (options.dryRun) {
    workLog.main(`待处理: ${describeCoverPlan(plan)}`, {
      type: 'item'
    });
    return 'pending';
  }

  reporter.startTask(id);

  let repaired = false;

  if (plan.missing.length) {
    const result = await repairCover(id, plan.missing);
    if (result === 'failed') return 'failed';
    repaired = true;
  }

  if (plan.stale.length) {
    workLog.progress(
      `main 已更新，重新生成缩略图: ${plan.stale.join(', ')}`
    );
    for (const type of plan.stale) {
      await generateCoverFromMain(id, type);
    }
    repaired = true;
  }

  let upgraded = 0;
  let failed = 0;

  if (plan.upgradable.length) {
    const reason = options.refreshAllCovers
      ? '按全量重取模式'
      : '本地生成的封面到了升级时间';
    workLog.progress(
      `${reason}，尝试从 DLsite 取原图: ${plan.upgradable.join(', ')}`
    );

    ({ upgraded, failed } = await upgradeCovers(id, plan.upgradable));
  }

  if (repaired) return 'repaired';
  if (upgraded) return 'upgraded';
  // 只有全量重取时下载失败才算这个作品失败，日常升级失败不影响可用性
  if (failed && options.refreshAllCovers) return 'failed';

  return 'skipped';
};

module.exports = {
  generateCoverFromMain,
  planCoverMaintenance,
  fetchCover,
  maintainCovers,
  upgradeCovers
};
