const fs = require('fs');
const path = require('path');

const {
  scrapeWorkMetadataFromDLsite
} = require('../../scraper/dlsite');
const db = require('../../database/db');
const {
  getFolderList,
  deleteCoverImageFromDisk,
  removeTemporaryCoverFiles,
  getTrackList,
  hasLrc
} = require('../utils');
const { formatRJLabel } = require('../../utils/workId');
const { config, findRootFolder } = require('../../config');
const { assertScanSubsystemProcess } = require('../scanWorkerGuard');
const { createParallelLimiter } = require('./concurrency');
const { fetchCover, maintainCovers } = require('./coverMaintenance');
const reporter = require('./reporter');

const uniqueArr = (arr) => {
  const uniqueList = [];
  const duplicate = {};

  for (let index = 0; index < arr.length; index++) {
    for (let next = index + 1; next < arr.length; next++) {
      if (arr[index].id === arr[next].id) {
        duplicate[arr[index].id] = duplicate[arr[index].id] || [];
        duplicate[arr[index].id].push(arr[index]);
        ++index;
      }
    }
    uniqueList.push(arr[index]);
  }

  return {
    uniqueArr: uniqueList,
    duplicate
  };
};

const getMetadata = (id, rootFolderId, dir) => {
  const workLog = reporter.forWork(id);
  workLog.progress('从 DLSite 抓取元数据...');

  return scrapeWorkMetadataFromDLsite(id)
    .then((metadata) => {
      const rootFolder = findRootFolder({ root_folder_id: rootFolderId });
      const absolutePath = path.join(rootFolder.path, dir);
      return getTrackList(id, absolutePath)
        .then((tracks) => {
          metadata.subtitle = hasLrc(tracks);
          return metadata;
        });
    })
    .then((metadata) => {
      workLog.success('元数据抓取成功，准备添加到数据库...');

      metadata.rootFolderId = rootFolderId;
      metadata.dir = dir;

      return db.insertWorkMetadata(metadata)
        .then(() => {
          workLog.success('元数据成功添加到数据库.');
          return 'added';
        })
        .catch((err) => {
          workLog.error(`在插入元数据过程中出错: ${err.message}`);
          return 'failed';
        });
    })
    .catch((err) => {
      workLog.error(`在抓取元数据过程中出错: ${err.message}`);
      return 'failed';
    });
};

const processFolder = async (folder, options = {}) => {
  const res = await db.knex('t_work')
    .select('id')
    .where('id', '=', folder.id)
    .count()
    .first();

  const count = res['count(*)'];

  if (count) return maintainCovers(folder.id, options);

  if (options.coversOnly) return 'skipped';

  reporter.startTask(folder.id);
  reporter.forWork(folder.id).progress(
    `发现新文件夹: "${folder.absolutePath}"`
  );

  const result = await getMetadata(
    folder.id,
    folder.rootFolderId,
    folder.relativePath
  );

  if (result === 'failed') return 'failed';
  return fetchCover(folder.id);
};

const performCleanup = async (
  folderCount,
  protectedWorkIds = new Set()
) => {
  const removedWorkIds = [];
  let orphanCounts = { tagCount: 0, circleCount: 0, vaCount: 0 };

  await db.knex.transaction(async trx => {
    const works = await trx('t_work').select('id', 'root_folder_id', 'dir');
    if (works.length > 0 && folderCount === 0) {
      reporter.main('本次未扫描到任何作品目录，为避免误删已停止清理.', {
        level: 'error',
        type: 'progress'
      });
      return;
    }

    for (const work of works) {
      if (protectedWorkIds.has(work.id)) continue;

      const rootFolder = findRootFolder(work);
      const workPath = rootFolder ? path.join(rootFolder.path, work.dir) : null;

      if (!workPath || !fs.existsSync(workPath)) {
        await db.removeWork(work.id, trx);
        removedWorkIds.push(work.id);
      }
    }

    orphanCounts = await db.cleanupOrphanEntities(trx);
  });

  // 数据库提交成功后再删除文件，避免事务回滚时封面已经丢失。
  for (const workId of removedWorkIds) {
    try {
      await deleteCoverImageFromDisk(workId);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        reporter.forWork(workId).main(
          `在删除封面过程中出错: ${err.message}`,
          {
            level: 'error',
            type: 'detail'
          }
        );
      }
    }
  }

  return {
    removedWorkCount: removedWorkIds.length,
    ...orphanCounts
  };
};

const prepareEnvironment = async () => {
  if (!fs.existsSync(config.coverFolderDir)) {
    fs.mkdirSync(config.coverFolderDir, { recursive: true });
  }

  // 上次扫描被中断时可能留下 .part 半成品
  await removeTemporaryCoverFiles();
};

const runCleanupStep = async (folderCount, protectedWorkIds) => {
  reporter.main('清理本地不再存在的音声的数据与封面图片...', {
    type: 'progress'
  });
  const result = await performCleanup(folderCount, protectedWorkIds);
  reporter.main(
    `清理完成，共清理 ${result.removedWorkCount} 个失效作品、${result.tagCount} 个孤立标签、${result.vaCount} 个孤立声优和 ${result.circleCount} 个孤立社团.`,
    {
      level: 'success',
      type: 'item'
    }
  );
  return result.removedWorkCount;
};

const collectAllFolders = async () => {
  reporter.main('收集音声文件夹', { type: 'phase' });
  const list = [];
  for (const rootFolder of config.rootFolders) {
    for await (const folder of getFolderList(rootFolder, '', 0, reporter.main)) {
      list.push(folder);
    }
  }
  reporter.main(`共找到 ${list.length} 个音声文件夹.`, { type: 'progress' });
  return list;
};

const handleDeduplication = (folderList) => {
  const { uniqueArr: uniqueList, duplicate } = uniqueArr(folderList);
  const duplicateNum = folderList.length - uniqueList.length;

  if (duplicateNum > 0) {
    reporter.main(`发现 ${duplicateNum} 个重复的音声文件夹.`, {
      level: 'warn',
      type: 'progress'
    });
    Object.keys(duplicate).forEach((key) => {
      reporter.forWork(key).main('存在多个文件夹.', {
        level: 'warn',
        type: 'item'
      });
    });
  }
  return { uniqueFolderList: uniqueList, duplicateNum };
};

const planMovedWorkRemap = ({
  works,
  folderList,
  rootFolders,
  pathExists = fs.existsSync
}) => {
  const candidatesByWorkId = new Map();
  for (const folder of folderList) {
    if (!candidatesByWorkId.has(folder.id)) {
      candidatesByWorkId.set(folder.id, []);
    }
    candidatesByWorkId.get(folder.id).push(folder);
  }

  const remaps = [];
  const ambiguous = [];

  for (const work of works) {
    const currentRootFolder = rootFolders.find(
      rootFolder => rootFolder.id === Number(work.root_folder_id)
    );
    const currentPath = currentRootFolder
      ? path.join(currentRootFolder.path, work.dir)
      : null;

    if (currentPath && pathExists(currentPath)) continue;

    const candidates = candidatesByWorkId.get(work.id) || [];
    if (candidates.length === 1) {
      const target = candidates[0];
      const targetRootFolder = rootFolders.find(
        rootFolder => rootFolder.id === Number(target.rootFolderId)
      );
      if (targetRootFolder) {
        remaps.push({
          work,
          target,
          currentRootFolder,
          targetRootFolder
        });
      }
    } else if (candidates.length > 1) {
      ambiguous.push({ work, candidates, currentRootFolder });
    }
  }

  return { remaps, ambiguous };
};

const remapMovedWorks = async (folderList) => {
  const works = await db.knex('t_work')
    .select('id', 'root_folder_id', 'dir');
  const { remaps, ambiguous } = planMovedWorkRemap({
    works,
    folderList,
    rootFolders: config.rootFolders
  });

  if (remaps.length > 0) {
    await db.knex.transaction(async trx => {
      for (const { work, target } of remaps) {
        const updated = await trx('t_work')
          .where({
            id: work.id,
            root_folder_id: work.root_folder_id,
            dir: work.dir
          })
          .update({
            root_folder_id: target.rootFolderId,
            dir: target.relativePath
          });
        if (updated !== 1) {
          throw new Error(
            `作品 ${formatRJLabel(work.id)} 的路径在扫描期间发生变化，已中止重映射.`
          );
        }
      }
    });
  }

  for (const {
    work,
    currentRootFolder,
    targetRootFolder,
    target
  } of remaps) {
    const oldRoot = currentRootFolder
      ? currentRootFolder.name
      : `#${work.root_folder_id}`;
    reporter.forWork(work.id).main(
      `已重映射路径: ${oldRoot}:${work.dir} -> ${targetRootFolder.name}:${target.relativePath}`,
      { type: 'detail' }
    );
  }
  for (const { work, candidates } of ambiguous) {
    reporter.forWork(work.id).main(
      `原路径不存在，但发现 ${candidates.length} 个候选目录，保留原记录等待人工处理.`,
      { level: 'warn', type: 'item' }
    );
  }

  return {
    remappedCount: remaps.length,
    protectedWorkIds: new Set(ambiguous.map(item => item.work.id))
  };
};

const processSingleFolder = async (
  folder,
  counts,
  options,
  limiter
) => {
  const workId = folder.id;
  let result;

  try {
    result = await limiter.call(processFolder, folder, options);
  } catch (err) {
    // 单个作品出错不能让整场扫描挂掉，记成失败继续跑
    reporter.forWork(workId).error(`处理出错: ${err.message}`);
    result = 'failed';
  }

  counts[result]++;
  reporter.finishTask(workId, result);

  if (result === 'skipped' || result === 'pending') return;

  reporter.recordResult(workId, result, counts[result]);
};

const finalizeScan = (counts, options = {}) => {
  const message = options.dryRun
    ? `检查完成（封面未做修改）: 需要处理 ${counts.pending} 个作品.`
    : `扫描完成: 重映射 ${counts.remapped} 个，新增 ${counts.added} 个，修复封面 ${counts.repaired} 个，升级封面 ${counts.upgraded} 个，跳过 ${counts.skipped} 个，失败 ${counts.failed} 个.`;
  const level = counts.failed ? 'warn' : 'success';

  reporter.finish({ message, level });
};

const performScan = async (options = {}) => {
  assertScanSubsystemProcess();

  try {
    const limiter = createParallelLimiter();

    await prepareEnvironment();

    const counts = {
      added: 0,
      repaired: 0,
      upgraded: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      updated: 0,
      remapped: 0
    };

    const folderList = await collectAllFolders();
    const { uniqueFolderList, duplicateNum } = handleDeduplication(folderList);
    counts.skipped += duplicateNum;

    reporter.main('同步路径与本地数据', { type: 'phase' });
    if (options.coversOnly) {
      reporter.main('只维护封面：不收录新作品，也不清理数据库.', {
        type: 'progress'
      });
    } else if (options.dryRun) {
      reporter.main('试运行：不重映射路径，也不清理数据库.', {
        type: 'progress'
      });
    } else if (config.skipCleanup) {
      reporter.main('根据设置跳过路径重映射与清理.', {
        type: 'progress'
      });
    } else {
      const { remappedCount, protectedWorkIds } =
        await remapMovedWorks(folderList);
      counts.remapped += remappedCount;
      await runCleanupStep(folderList.length, protectedWorkIds);
    }

    reporter.main('处理音声作品', { type: 'phase' });
    await Promise.all(
      uniqueFolderList.map(folder => (
        processSingleFolder(folder, counts, options, limiter)
      ))
    );

    finalizeScan(counts, options);
    return counts;
  } catch (err) {
    reporter.main(`扫描过程中出错: ${err.message}`, {
      level: 'error',
      type: 'summary'
    });
    throw err;
  }
};

module.exports = {
  performScan,
  planMovedWorkRemap
};
