const {
  scrapeWorkMetadataFromDLsite,
  isDlsiteBlockedError
} = require('../../scraper/dlsite');
const db = require('../../database/db');
const { config } = require('../../config');
const { assertScanSubsystemProcess } = require('../scanWorkerGuard');
const { createParallelLimiter } = require('./concurrency');
const reporter = require('./reporter');

const DELISTED_WORK_UPDATE_TIME = '2099-01-01 00:00:00';

const updateMetadata = (id, options = {}) => {
  const workLog = reporter.forWork(id);

  reporter.startTask(id);
  return scrapeWorkMetadataFromDLsite(id)
    .then((metadata) => {
      workLog.success('元数据抓取成功，准备更新元数据...');
      metadata.id = id;
      const updateOptions = {
        ...(options || {}),
        ...(metadata.isDelisted
          ? { updateTime: DELISTED_WORK_UPDATE_TIME }
          : {})
      };
      return db.updateWorkMetadata(metadata, updateOptions)
        .then(() => {
          const successMessage = metadata.isDelisted
            ? '作品已下架，刷新时间已推迟至 2099 年'
            : '元数据更新成功';
          workLog.success(successMessage);
          return 'updated';
        });
    })
    .catch(async (err) => {
      let failure = err;
      if (failure.code === 'DLSITE_PRODUCT_UNAVAILABLE') {
        try {
          await db.updateWorkMetadata(
            { id },
            { updateTime: DELISTED_WORK_UPDATE_TIME }
          );
          workLog.warn('作品已下架，刷新时间已推迟至 2099 年.');
          return 'delisted';
        } catch (dbError) {
          failure = dbError;
        }
      }

      if (isDlsiteBlockedError(failure)) {
        workLog.warn(
          `DLsite 请求受限，暂停剩余刷新任务: ${failure.message}`
        );
        return 'blocked';
      }

      workLog.error(`在抓取元数据过程中出错: ${failure}`);
      return 'failed';
    });
};

const refreshWorks = async (works, limiter, processor) => {
  const counts = {
    updated: 0,
    delisted: 0,
    failed: 0,
    paused: 0
  };
  let blocked = false;

  const processWork = async (workId) => {
    if (blocked) return;

    const result = await processor(workId);
    reporter.finishTask(workId, result);

    if (result === 'updated') {
      counts.updated += 1;
      reporter.recordResult(workId, 'updated', counts.updated);
    } else if (result === 'delisted') {
      counts.delisted += 1;
      reporter.recordResult(workId, 'delisted', counts.delisted);
    } else if (result === 'blocked') {
      blocked = true;
      reporter.recordResult(workId, 'blocked', works.length);
    } else {
      counts.failed += 1;
      reporter.recordResult(workId, 'failed', counts.failed);
    }
  };

  await Promise.all(
    works.map(work => limiter.call(processWork, work.id))
  );
  counts.paused =
    works.length - counts.updated - counts.delisted - counts.failed;

  const delistedSummary = counts.delisted
    ? `，已下架 ${counts.delisted} 个`
    : '';
  reporter.main(
    `完成元数据更新 ${counts.updated} 个${delistedSummary}，失败 ${counts.failed} 个.`,
    {
      level: counts.failed || counts.paused ? 'warn' : 'success',
      type: 'summary'
    }
  );
  return counts;
};

const performUpdate = async (options = null) => {
  assertScanSubsystemProcess();

  reporter.main('刷新作品元数据', { type: 'phase' });
  const works = await db.getWorksDueForMetadataRefresh({
    batchSize: config.metadataRefreshBatchSize,
    staleDays: config.metadataRefreshStaleDays
  });

  if (works.length === 0) {
    const message =
      `没有 ${config.metadataRefreshStaleDays} 天前需要刷新的作品.`;
    reporter.finish({
      message,
      level: 'success'
    });
    return { updated: 0, delisted: 0, failed: 0, paused: 0 };
  }

  reporter.main(
    `本次选择 ${works.length} 个作品，只刷新 ${config.metadataRefreshStaleDays} 天前更新的数据.`,
    { type: 'progress' }
  );
  const limiter = createParallelLimiter();
  const counts = await refreshWorks(
    works,
    limiter,
    id => updateMetadata(id, options)
  );
  const paused = counts.paused > 0;
  const delistedSummary = counts.delisted
    ? `已下架 ${counts.delisted} 个，`
    : '';
  const message = paused
    ? `刷新已暂停: 更新 ${counts.updated} 个，${delistedSummary}失败 ${counts.failed} 个，剩余 ${counts.paused} 个.`
    : `刷新完成: 更新 ${counts.updated} 个，${delistedSummary}失败 ${counts.failed} 个.`;
  const level = paused || counts.failed ? 'warn' : 'success';
  reporter.finish({ message, level });
  return counts;
};

module.exports = { performUpdate };
