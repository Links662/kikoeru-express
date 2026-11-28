const {
  scrapeTagCatalogFromDLsite
} = require('../../scraper/dlsite');
const db = require('../../database/db');
const { assertScanSubsystemProcess } = require('../scanWorkerGuard');
const reporter = require('./reporter');

const performTagScan = async () => {
  assertScanSubsystemProcess();

  reporter.main('扫描 DLsite 标签列表', { type: 'phase' });
  reporter.main('正在抓取日文、简体中文和繁体中文标签...', {
    type: 'progress'
  });

  const tags = await scrapeTagCatalogFromDLsite();
  const counts = await db.upsertTagCatalog(tags);
  const message =
    `标签列表扫描完成: 新增 ${counts.inserted} 个，更新 ${counts.updated} 个，共计 ${tags.length} 个.`;

  reporter.finish({
    message,
    level: 'success'
  });
  return counts;
};

module.exports = {
  performTagScan
};
