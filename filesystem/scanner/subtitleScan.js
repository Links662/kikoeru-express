const path = require('path');

const db = require('../../database/db');
const { getTrackList, hasLrc } = require('../utils');
const { findRootFolder } = require('../../config');
const { assertScanSubsystemProcess } = require('../scanWorkerGuard');
const { createParallelLimiter } = require('./concurrency');
const reporter = require('./reporter');

const scanSubtitleForWork = async (work, counts) => {
  const rootFolder = findRootFolder(work);

  if (!rootFolder) {
    counts.failed += 1;
    reporter.recordResult(
      work.id,
      'failed',
      counts.failed,
      `找不到根目录 #${work.root_folder_id}，保留原中文字幕状态`
    );
    return;
  }

  try {
    const tracks = await getTrackList(
      work.id,
      path.join(rootFolder.path, work.dir)
    );
    const subtitle = hasLrc(tracks);

    if (Boolean(work.subtitle) === subtitle) {
      counts.skipped += 1;
      return;
    }

    await db.updateWorkSubtitle(work.id, subtitle);
    counts.updated += 1;
    reporter.forWork(work.id).console(
      `中文字幕状态已更新为 ${subtitle ? '中文字幕' : '无中文字幕'}.`,
      { level: 'success', type: 'item' }
    );
  } catch (err) {
    counts.failed += 1;
    reporter.recordResult(
      work.id,
      'failed',
      counts.failed,
      `扫描中文字幕失败: ${err.message}`
    );
  }
};

const performSubtitleScan = async () => {
  assertScanSubsystemProcess();

  const limiter = createParallelLimiter();
  const works = await db.knex('t_work')
    .select('id', 'root_folder_id', 'dir', 'subtitle');
  const counts = {
    updated: 0,
    skipped: 0,
    failed: 0
  };

  reporter.main('扫描中文字幕', { type: 'phase' });
  reporter.main(
    `共 ${works.length} 个作品，开始扫描中文字幕...`,
    { type: 'progress' }
  );
  await Promise.all(
    works.map(work => limiter.call(scanSubtitleForWork, work, counts))
  );

  const message =
    `中文字幕扫描完成: 更新 ${counts.updated} 个，跳过 ${counts.skipped} 个，失败 ${counts.failed} 个.`;
  const level = counts.failed ? 'warn' : 'success';
  reporter.finish({ message, level });
  return counts;
};

module.exports = { performSubtitleScan };
