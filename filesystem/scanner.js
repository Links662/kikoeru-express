const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { performScan } = require('./scannerModules')

const argv = yargs(hideBin(process.argv))
  .option('covers', {
    description: '只维护封面：补缺失、重新生成过期缩略图、把本地生成的降级图换成 DLsite 原图',
    type: 'boolean'
  })
  .option('all', {
    description: '配合 --covers：连 DLsite 的原图一起重新下载（怀疑真图损坏时用）',
    type: 'boolean'
  })
  .option('dry-run', {
    description: '配合 --covers：只列出需要处理的作品，不做任何修改',
    type: 'boolean'
  })
  .argv;

performScan({
  coversOnly: Boolean(argv.covers),
  refreshAllCovers: Boolean(argv.all),
  dryRun: Boolean(argv['dry-run'])
});
