const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const LimitPromise = require('limit-promise');

const axios = require('../scraper/axios.js');
const { scrapeWorkMetadataFromDLsite } = require('../scraper/dlsite');
const db = require('../database/db');
const {
  getFolderList,
  deleteCoverImageFromDisk,
  saveCoverImageToDisk,
  removeTemporaryCoverFiles,
  getTrackList,
  COVER_TYPES,
  coverFilePath,
  isUsableCoverFile,
  readCoverOrigin,
  markCoverAsGenerated,
  getFileStamp,
  hasLrc
} = require('./utils');
const { formatRJLabel } = require('../utils/workId');
const { config } = require('../config');

// 只有在子进程中 process 对象才有 send() 方法
process.send = process.send || function () {};

const tasks = [];
const failedTasks = [];
const mainLogs = [];
const results = [];

const getTask = (workId) => tasks.find(task => task.workId === Number(workId));

const addTask = (workId) => tasks.push({
  workId: Number(workId),
  result: null,
  logs: []
});

const removeTask = (workId) => {
  const index = tasks.findIndex(task => task.workId === Number(workId));
  // 任务已经被移除时直接返回，否则 splice(-1, 1) 会误删列表里的最后一个任务
  if (index === -1) return;

  const task = tasks.splice(index, 1)[0];
  process.send({
    event: 'SCAN_TASKS',
    payload: {
      tasks
    }
  });

  if (task.result === 'failed') {
    failedTasks.push(task);
    process.send({
      event: 'SCAN_FAILED_TASKS',
      payload: {
        failedTasks
      }
    });
  }
};

const addLogForTask = (workId, log) => {
  const task = getTask(workId);
  // 任务还没创建或已经被移除时，日志退回主日志，不能在这里抛错
  if (!task) return false;

  task.logs.push(log);
  process.send({
    event: 'SCAN_TASKS',
    payload: {
      tasks
    }
  });

  return true;
};

const addResult = (workId, result, count) => {
  results.push({
    workId: Number(workId),
    result,
    count
  });
  process.send({
    event: 'SCAN_RESULTS',
    payload: {
      results
    }
  });
};

const addMainLog = (log) => {
  mainLogs.push(log);
  process.send({
    event: 'SCAN_MAIN_LOGS',
    payload: {
      mainLogs
    }
  });
};

const emitMainLog = (message, level = 'info', truncate = 0) => {
  console.log(message);
  addMainLog({
    level: level,
    message: message.substring(truncate)
  });
};

const emitTaskLog = (message, workId, level = 'info', truncate = 0) => {
  console.log(message);
  const log = {
    level: level,
    message: message.substring(truncate)
  };

  if (!addLogForTask(workId, log)) addMainLog(log);
}

process.on('message', (m) => {
  if (m.emit === 'SCAN_INIT_STATE') {
    process.send({
      event: 'SCAN_INIT_STATE',
      payload: {
        tasks,
        failedTasks,
        mainLogs,
        results
      }
    });
  } else if (m.exit) {
    emitMainLog('终止扫描进程.', 'error', 0);
    process.exit(1);
  }
});


/**
 * 通过数组 arr 中每个对象的 id 属性来对数组去重
 * @param {Array} arr 
 */
const uniqueArr = (arr) => {
  const uniqueArr = [];
  const duplicate = {};

  for (let i=0; i<arr.length; i++) {
    for (let j=i+1; j<arr.length; j++) {
      if (arr[i].id === arr[j].id) {
        duplicate[arr[i].id] = duplicate[arr[i].id] || [];
        duplicate[arr[i].id].push(arr[i]);
        ++i;
      }
    }
    uniqueArr.push(arr[i]);
  }

  return {
    uniqueArr, // 去重后的数组
    duplicate, // 对象，键为id，值为多余的重复项数组
  };
};

/**
 * 从 DLsite 抓取该音声的元数据，并保存到数据库，
 * 返回一个 Promise 对象，处理结果: 'added' or 'failed'
 * @param {number} id work id
 * @param {string} rootFolderName 根文件夹别名
 * @param {string} dir 音声文件夹相对路径
 * @param {string} tagLanguage 标签语言，'ja-JP', 'zh-TW' or 'zh-CN'，默认'zh-CN'
 */
const getMetadata = (id, rootFolderName, dir, tagLanguage) => {
  const rjLabel = formatRJLabel(id);
  emitTaskLog(`[${rjLabel}] 从 DLSite 抓取元数据...`, id);
  
  return scrapeWorkMetadataFromDLsite(id, tagLanguage)
    .then((metadata) => {
      const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === rootFolderName);
      const absolutePath = path.join(rootFolder.path, dir);
      console.log(absolutePath)
      return getTrackList(id, absolutePath)
      .then((tracks) => {
        metadata.subtitle = hasLrc(tracks)
        return metadata
      })
    })
    .then((metadata) => {
      emitTaskLog(`[${rjLabel}] 元数据抓取成功，准备添加到数据库...`, id);
      
      metadata.rootFolderName = rootFolderName;
      metadata.dir = dir;

      return db.insertWorkMetadata(metadata)
        .then(() => {
          emitTaskLog(`[${rjLabel}] 元数据成功添加到数据库.`, id);
          
          return 'added';
        })
        .catch((err) => {
          emitTaskLog(`[${rjLabel}] 在插入元数据过程中出错: ${err.message}`, id, 'error');
          
          return 'failed';
        });
    })
    .catch((err) => {
      emitTaskLog(`[${rjLabel}] 在抓取元数据过程中出错: ${err.message}`, id, 'error');
      
      return 'failed';
    });
};

/**
 * 从 DLsite 下载封面图片，并保存到 Images 文件夹，
 * @param {number} id work id
 * @param {Array} types img types: 'main' / 'sam' / '240x240'
 * @returns {Promise<{succeeded: Array, failed: Array}>} 各类型各自的下载结果
 */
const getCoverImage = async (id, types) => {
  const rjLabel = formatRJLabel(id);

  // DLsite 的图片按每 1000 个 RJ 号分目录存放
  const id2 = (id % 1000 === 0) ? id : parseInt(id / 1000, 10) * 1000 + 1000;
  const rjLabel2 = formatRJLabel(id2);

  emitTaskLog(`[${rjLabel}] 从 DLsite 下载封面...`, id);

  const succeeded = [];
  const failed = [];

  for (const type of types) {
    let url = `https://img.dlsite.jp/modpub/images2/work/doujin/${rjLabel2}/${rjLabel}_img_${type}.jpg`;
    // 240x240 / 360x360 走 resize 线，其余的（main、sam、sam@2x ...）都是原路径
    if (type === '240x240' || type === '360x360') {
      url = `https://img.dlsite.jp/resize/images2/work/doujin/${rjLabel2}/${rjLabel}_img_main_${type}.jpg`;
    }

    try {
      const imageRes = await axios.retryGet(url, { responseType: "stream", retry: {} });
      await saveCoverImageToDisk(imageRes.data, id, type);

      emitTaskLog(`[${rjLabel}] 封面 ${rjLabel}_img_${type}.jpg 下载成功.`, id);
      succeeded.push(type);
    } catch (err) {
      // 非 2xx 时响应体没有被消费，主动释放，避免批量扫描时一直占着 socket
      if (err.response && err.response.data && err.response.data.destroy) err.response.data.destroy();

      emitTaskLog(`[${rjLabel}] 在下载封面 ${rjLabel}_img_${type}.jpg 过程中出错: ${err.message}`, id, 'error');
      failed.push(type);
    }
  }

  return { succeeded, failed };
};

/**
 * 可以由 main 派生出来的缩略图规格。
 * 240x240：DLsite 的资产就是 main 的等比缩放（实测 560x420 -> 240x180，比例完全一致），
 *          本地生成与重新下载等价，但不需要联网，DLsite 缺这个尺寸/被限流也能自愈。
 * sam：DLsite 的 sam 是「原图」的等比缩略（100x100 / 100x75 ...），原图上下部分在 main 里
 *      已经被裁掉了，所以由 main 生成的 sam 只是降级版本，仅用于下载不到时兜底。
 */
const DERIVED_COVER_SPECS = {
  '240x240': { width: 240, quality: 90 },
  'sam': { width: 100, quality: 85 }
};

/**
 * 由 main 生成一张缩略图（先写 .part 再改名）。
 * @param {Number|String} id work id
 * @param {String} type '240x240' or 'sam'
 * @returns {Promise<Boolean>} 是否生成成功
 */
const generateCoverFromMain = async (id, type) => {
  const spec = DERIVED_COVER_SPECS[type];
  if (!spec) return false;

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

    emitTaskLog(`[${formatRJLabel(id)}] 已由 main 生成 ${type} 缩略图.`, id);
    return true;
  } catch (err) {
    await fs.promises.unlink(tempPath).catch(() => {});
    emitTaskLog(`[${formatRJLabel(id)}] 由 main 生成 ${type} 缩略图失败: ${err.message}`, id, 'error');
    return false;
  }
};

/**
 * 给刚生成的封面写来源标记（顺带记下 main 的 size/mtime，main 换了就知道该重新生成）。
 */
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
    // 标记只是「以后能升级」的依据，写不上不该让整张图白生成
    emitTaskLog(`[${formatRJLabel(id)}] 无法写入 ${type} 的来源标记（将不会自动升级）: ${err.message}`, id, 'error');
  }
};

/**
 * 记下一次失败的升级尝试（保留原本的生成时间），按间隔退避之后再试。
 */
const markCoverUpgradeAttempt = async (id, type, origin) => {
  try {
    await markCoverAsGenerated(coverFilePath(id, type), Object.assign({}, origin, {
      tried: Date.now()
    }));
  } catch (err) {
    emitTaskLog(`[${formatRJLabel(id)}] 无法记录 ${type} 的升级尝试: ${err.message}`, id, 'error');
  }
};

/**
 * 本地生成的缩略图是否已经过期（main 被换过）。
 */
const isGeneratedCoverStale = (id, origin) => {
  const stamp = getFileStamp(coverFilePath(id, 'main'));

  if (!stamp) return false;
  return stamp.size !== origin.mainSize || stamp.mtime !== origin.mainMtime;
};

/**
 * 这张本地生成的图是否到了「换成 DLsite 原图」的时间。
 * 生成之后还没试过就立刻试（下一次扫描），失败过则按 coverUpgradeIntervalDays 退避。
 */
const isCoverUpgradeDue = (type, origin) => {
  if (!config.coverUpgradeTypes.includes(type)) return false;

  const interval = (config.coverUpgradeIntervalDays || 0) * 24 * 60 * 60 * 1000;
  if (!interval) return true;

  return !origin.tried || Date.now() - origin.tried >= interval;
};

/**
 * 检查一部作品的封面，得到需要做的维护动作。
 * @param {Number|String} id work id
 * @param {Object} options { refreshAllCovers }
 * @returns {{missing: Array, stale: Array, upgradable: Array}}
 */
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

    if (!DERIVED_COVER_SPECS[type]) continue; // main 没有「派生」的概念

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

/**
 * 把本地生成的降级缩略图换成 DLsite 的原图。
 * 下载成功会直接覆盖原文件（标记随之消失）；失败则记下这次尝试，按间隔退避。
 * @returns {Promise<{upgraded: Number, failed: Number}>}
 */
const upgradeCovers = async (id, types) => {
  let upgraded = 0;
  let failed = 0;

  for (const type of types) {
    const origin = readCoverOrigin(coverFilePath(id, type));
    const results = await getCoverImage(id, [type]);

    if (results.succeeded.includes(type)) {
      upgraded += 1;
    } else {
      // 没换成原图：记录尝试时间后按间隔再试
      if (origin) await markCoverUpgradeAttempt(id, type, origin);
      failed += 1;
    }
  }

  return { upgraded, failed };
};

/**
 * 把仍然缺失的缩略图用 main 就地补齐（调用前需确保 main 可用）。
 * @param {Number|String} id work id
 * @param {Array} types 只处理这些类型
 */
const generateMissingThumbnails = async (id, types) => {
  for (const type of types) {
    if (!DERIVED_COVER_SPECS[type]) continue;
    if (isUsableCoverFile(coverFilePath(id, type))) continue;

    await generateCoverFromMain(id, type);
  }
};

/**
 * 下载一部新作品的封面：main 是必需资源，缩略图拿不到时由 main 本地生成。
 * @returns {Promise<'added'|'failed'>}
 */
const fetchCover = async (id) => {
  await getCoverImage(id, COVER_TYPES);

  if (!isUsableCoverFile(coverFilePath(id, 'main'))) return 'failed';

  await generateMissingThumbnails(id, COVER_TYPES);

  return 'added';
};

/**
 * 补齐已收录作品缺失的封面。
 * - main 缺失或损坏：重新下载（连缺失的缩略图一起）
 * - main 完好而缺 sam：sam 无法由 main 还原，先按 DLsite 的资源取一次
 * - 240x240 缺失：与 DLsite 的资产等价，本地生成即可，不联网
 * - 最后仍然缺的缩略图（比如 sam 下载不到）由 main 生成兜底
 * @returns {Promise<'repaired'|'failed'>}
 */
const repairCover = async (id, missingTypes) => {
  if (missingTypes.includes('main')) {
    emitTaskLog(`[${formatRJLabel(id)}] 封面图片缺失或损坏，重新下载: ${missingTypes.join(', ')}`, id);
    await getCoverImage(id, missingTypes);

    if (!isUsableCoverFile(coverFilePath(id, 'main'))) return 'failed';
  } else if (missingTypes.includes('sam')) {
    emitTaskLog(`[${formatRJLabel(id)}] sam 缩略图缺失，从 DLsite 重新获取...`, id);
    await getCoverImage(id, ['sam']);
  }

  // 走到这里 main 一定可用：仍然缺的缩略图就地生成（生成失败也只是少一张小图）
  await generateMissingThumbnails(id, missingTypes);

  return 'repaired';
};

/**
 * 维护一部作品的封面：补缺失的、重新生成过期的、把本地生成的降级图换成 DLsite 原图。
 * @param {number} id work id
 * @param {Object} options { dryRun, refreshAllCovers }
 * @returns {Promise<'repaired'|'upgraded'|'skipped'|'pending'|'failed'>}
 */
const maintainCovers = async (id, options = {}) => {
  const plan = planCoverMaintenance(id, options);

  if (!plan.missing.length && !plan.stale.length && !plan.upgradable.length) return 'skipped';

  if (options.dryRun) {
    emitMainLog(`[${formatRJLabel(id)}] 待处理: ${describeCoverPlan(plan)}`, 'info', 0);
    return 'pending';
  }

  addTask(id);

  let repaired = false;

  if (plan.missing.length) {
    const result = await repairCover(id, plan.missing);
    if (result === 'failed') return 'failed';
    repaired = true;
  }

  if (plan.stale.length) {
    emitTaskLog(`[${formatRJLabel(id)}] main 已更新，重新生成缩略图: ${plan.stale.join(', ')}`, id);
    for (const type of plan.stale) {
      await generateCoverFromMain(id, type);
    }
    repaired = true;
  }

  let upgraded = 0;
  let failed = 0;

  if (plan.upgradable.length) {
    const reason = options.refreshAllCovers ? '按全量重取模式' : '本地生成的封面到了升级时间';
    emitTaskLog(`[${formatRJLabel(id)}] ${reason}，尝试从 DLsite 取原图: ${plan.upgradable.join(', ')}`, id);

    ({ upgraded, failed } = await upgradeCovers(id, plan.upgradable));
  }

  if (repaired) return 'repaired';
  if (upgraded) return 'upgraded';
  // 只有「全部重取」时下载失败才算这个作品失败：日常的到期升级失败不影响这张图可用
  if (failed && options.refreshAllCovers) return 'failed';

  return 'skipped';
};

/**
 * 获取音声元数据，获取音声封面图片，
 * 返回一个 Promise 对象，处理结果: 'added', 'repaired', 'upgraded', 'skipped' or 'failed'
 * @param {string} folder 音声文件夹对象 { relativePath: '相对路径', rootFolderName: '根文件夹别名', id: '音声ID' }
 * @param {Object} options { coversOnly, dryRun, refreshAllCovers }
 */
const processFolder = async (folder, options = {}) => {
  const res = await db.knex('t_work')
    .select('id')
    .where('id', '=', folder.id)
    .count()
    .first();

  const count = res['count(*)'];

  if (count) return await maintainCovers(folder.id, options); // 已写入元数据，只维护封面

  // 只维护封面时不收录新作品
  if (options.coversOnly) return 'skipped';
  else {
    console.log(` * 发现新文件夹: "${folder.absolutePath}"`);
    addTask(folder.id);
    addLogForTask(folder.id, {
      level: 'info',
      message: `发现新文件夹: "${folder.absolutePath}"`
    });

    const result = await getMetadata(folder.id, folder.rootFolderName, folder.relativePath, config.tagLanguage);

    if (result === 'failed') return 'failed';
    return await fetchCover(folder.id);
  }
};

const MAX = config.maxParallelism;
const limitP = new LimitPromise(MAX);
/**
 * 限制 processFolder 并发数量，
 * 使用控制器包装 processFolder 方法，实际上是将请求函数递交给控制器处理
 */
const processFolderLimited = (folder, options) => {
  return limitP.call(processFolder, folder, options);
};

/**
 * 清理本地不再存在的音声: 将其元数据从数据库中移除，并删除其封面图片
 */
const performCleanup = async () => {
  const trxProvider = db.knex.transactionProvider();
  const trx = await trxProvider();
  const works = await trx('t_work').select('id', 'root_folder', 'dir');
  const promises = works.map(work => new Promise((resolve, reject) => {
    // 检查每个音声的根文件夹或本地路径是否仍然存在
    const rootFolder = config.rootFolders.find(rootFolder => rootFolder.name === work.root_folder);
    if (!rootFolder || !fs.existsSync(path.join(rootFolder.path, work.dir))) {
      db.removeWork(work.id, trxProvider)
        .then((result) => {
          const rjLabel = formatRJLabel(work.id);
          deleteCoverImageFromDisk(work.id)    
            .catch((err) => {
              if (err && err.code !== 'ENOENT') { 
                emitMainLog(`[${rjLabel}] 在删除封面过程中出错: ${err.message}`, 'error', 0);
              }
            })
            .then(() => resolve(result));
        })
        .catch(err => reject(err));
    } else {
      resolve();
    }
  }));

  await Promise.all(promises);
  trx.commit();
};

const prepareEnvironment = async () => {
  if (!fs.existsSync(config.coverFolderDir)) {
    fs.mkdirSync(config.coverFolderDir, { recursive: true });
  }

  // 上次扫描被中断时可能留下 .part 半成品
  await removeTemporaryCoverFiles();
};

const runCleanupStep = async () => {
  emitMainLog('清理本地不再存在的音声的数据与封面图片...', 'info', 0);
  await performCleanup();
  emitMainLog('清理完成. 现在开始扫描...', 'info', 0);
};

const collectAllFolders = async () => {
  let list = [];
  for (const rootFolder of config.rootFolders) {
    for await (const folder of getFolderList(rootFolder, '', 0, addMainLog)) {
      list.push(folder);
    }
  }
  emitMainLog(` * 共找到 ${list.length} 个音声文件夹.`, 'info', 3);
  return list;
};

const handleDeduplication = (folderList) => {
  const { uniqueArr: uniqueList, duplicate } = uniqueArr(folderList);
  const duplicateNum = folderList.length - uniqueList.length;

  if (duplicateNum > 0) {
    emitMainLog(` ! 发现 ${duplicateNum} 个重复的音声文件夹.`, 'info', 3);
    Object.keys(duplicate).forEach(key => {
      emitMainLog(` -> [${formatRJLabel(key)}] 存在多个文件夹.`, 'info', 4);
    });
  }
  return { uniqueFolderList: uniqueList, duplicateNum };
};

const processSingleFolder = async (folder, counts, options = {}) => {
  const workId = folder.id;
  const rjLabel = formatRJLabel(workId);
  let result;

  try {
    result = await processFolderLimited(folder, options);
  } catch (err) {
    // 单个作品出错不能让整场扫描挂掉，记成失败继续跑
    emitTaskLog(`[${rjLabel}] 处理出错: ${err.message}`, workId, 'error');
    result = 'failed';
  }

  counts[result]++;

  // 任务无论如何都要从「处理中」摘掉，否则失败的路径会把它一直挂在那里
  const task = getTask(workId);
  if (task) task.result = result;
  removeTask(workId);

  if (result === 'skipped' || result === 'pending') return;

  const isSuccess = result !== 'failed';
  const statusText = {
    added: '添加成功',
    repaired: '封面修复成功',
    upgraded: '封面升级成功',
    failed: '处理失败'
  }[result];

  console[isSuccess ? 'log' : 'error'](`[${rjLabel}] ${statusText}! ${result.toUpperCase()}: ${counts[result]}`);

  addResult(workId, result, counts[result]);
};

const finalizeScan = (counts, options = {}) => {
  const message = options.dryRun
    ? `检查完成（未做任何修改）: 需要处理 ${counts.pending} 个作品.`
    : `扫描完成: 新增 ${counts.added} 个，修复封面 ${counts.repaired} 个，升级封面 ${counts.upgraded} 个，跳过 ${counts.skipped} 个，失败 ${counts.failed} 个.`;

  console.log(` * ${message}`);
  process.send({ event: 'SCAN_FINISHED', payload: { message } });

  db.knex.destroy();
  process.exit(0);
};
/**
 * 执行扫描
 * createCoverFolder => createSchema => cleanup => getAllFolderList => processAllFolder
 * @param {Object} options { coversOnly, refreshAllCovers, dryRun }
 */
const performScan = async (options = {}) => {
  try {
    // 1. 准备阶段
    await prepareEnvironment();

    const counts = { added: 0, repaired: 0, upgraded: 0, failed: 0, skipped: 0, pending: 0, updated: 0 };

    // 2. 数据清理阶段
    if (options.coversOnly) {
      // 封面维护是定点操作，不删数据也不动数据库
      emitMainLog(' * 只维护封面：不收录新作品，也不清理数据库.', 'info', 3);
    } else if (config.skipCleanup) {
      emitMainLog(' * 根据设置跳过清理.', 'info', 3);
    } else {
      await runCleanupStep();
    }

    // 3. 文件获取与去重阶段
    const folderList = await collectAllFolders();
    const { uniqueFolderList, duplicateNum } = handleDeduplication(folderList);
    counts.skipped += duplicateNum;

    // 4. 核心处理阶段 (并行执行)
    await Promise.all(
      uniqueFolderList.map(folder => processSingleFolder(folder, counts, options))
    );

    // 5. 收尾阶段
    finalizeScan(counts, options);

  } catch (err) {
    emitMainLog(` ! 扫描过程中出错: ${err.message}`, 'error', 3);
    process.exit(1);
  }
};

/**
 * 更新音声的动态元数据
 * @param {number} id work id
 * @param {options = {}} options includeVA, includeTags
 */
const updateMetadata = (id, options = {}) => {
  let scrapeProcessor = () => scrapeWorkMetadataFromDLsite(id, config.tagLanguage);

  const rjLabel = formatRJLabel(id);
  addTask(id);
  return scrapeProcessor()
    .then((metadata) => {
      emitTaskLog(`[${rjLabel}] 元数据抓取成功，准备更新元数据...`, id);
      metadata.id = id;
      return db.updateWorkMetadata(metadata, options)
        .then(() => {
          emitTaskLog(`[${rjLabel}] 元数据更新成功`, id);
          return 'updated';
        });
    })
    .catch((err) => {
      emitTaskLog(`[${rjLabel}] 在抓取元数据过程中出错: ${err}`, id, 'error');
      return 'failed';
    });
};

const updateMetadataLimited = (id, options = null) => limitP.call(updateMetadata, id, options);
const scanSubtitleForWork = async (work, counts) => {
  const rjLabel = formatRJLabel(work.id);
  const rootFolder = config.rootFolders.find(folder => folder.name === work.root_folder);

  if (!rootFolder) {
    counts.failed += 1;
    emitMainLog(`[${rjLabel}] 找不到根文件夹 "${work.root_folder}"，保留原中文字幕状态.`, 'error', 0);
    addResult(work.id, 'failed', counts.failed);
    return;
  }

  try {
    const tracks = await getTrackList(work.id, path.join(rootFolder.path, work.dir));
    const subtitle = hasLrc(tracks);

    if (Boolean(work.subtitle) === subtitle) {
      counts.skipped += 1;
      return;
    }

    await db.updateWorkSubtitle(work.id, subtitle);
    counts.updated += 1;
    console.log(`[${rjLabel}] 中文字幕状态已更新为 ${subtitle ? '中文字幕' : '无中文字幕'}.`);
  } catch (err) {
    counts.failed += 1;
    emitMainLog(`[${rjLabel}] 扫描中文字幕失败: ${err.message}`, 'error', 0);
    addResult(work.id, 'failed', counts.failed);
  }
};

const performSubtitleScan = async () => {
  const works = await db.knex('t_work').select('id', 'root_folder', 'dir', 'subtitle');
  const counts = {
    updated: 0,
    skipped: 0,
    failed: 0
  };

  emitMainLog(` * 共 ${works.length} 个作品，开始扫描中文字幕...`, 'info', 3);
  await Promise.all(works.map(work => limitP.call(scanSubtitleForWork, work, counts)));

  const message = `中文字幕扫描完成: 更新 ${counts.updated} 个，跳过 ${counts.skipped} 个，失败 ${counts.failed} 个.`;
  console.log(` * ${message}`);
  process.send({
    event: 'SCAN_FINISHED',
    payload: {
      message
    }
  });

  db.knex.destroy();
  process.exit(counts.failed ? 1 : 0);
};

const performUpdate = async (options = null) => {
  const baseQuery = db.knex('t_work').select('id');
  const processor = (id) => updateMetadataLimited(id, options);

  const counts = await refreshWorks(baseQuery, 'id', processor);

  const message = `扫描完成: 更新 ${counts.updated} 个，失败 ${counts.failed} 个.`;
  console.log(` * ${message}`);
  process.send({
    event: 'SCAN_FINISHED',
    payload: {
      message: message
    }
  });
  db.knex.destroy();
  if (counts.failed) process.exit(1);
};

const refreshWorks = async (query, idColumnName, processor) => {
  return query.then(async (works) => {
    emitMainLog(` * 共 ${works.length} 个音声. 开始刷新`, 'info', 3);

    const counts = {
      updated: 0,
      failed: 0,
    }; 

    const promises = works.map((work) => {
      const workid = work[idColumnName];
      return processor(workid)
        .then((result) => {
          result === 'failed' ? counts['failed'] += 1 : counts['updated'] += 1;
          const task = getTask(workid);
          if (task) task.result = result;
          removeTask(workid);
          if (result === 'failed') {
            addResult(workid, 'failed', counts.failed);
          } else {
            addResult(workid, 'updated', counts.updated);
          }
      })
    });
    await Promise.all(promises);
    emitMainLog(` * 完成元数据更新 ${counts.updated} 个，失败 ${counts.failed} 个.`, 'info', 3);

    return counts;
  });
};

module.exports = {
  performScan,
  performUpdate,
  performSubtitleScan,
  // 下面几个主要给测试用（封面维护的核心逻辑，不碰数据库）
  generateCoverFromMain,
  planCoverMaintenance,
  maintainCovers,
  upgradeCovers
};
