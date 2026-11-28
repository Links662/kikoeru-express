const path = require('path');

const SCAN_DEFINITIONS = Object.freeze([
  {
    kind: 'scan',
    actionEvent: 'PERFORM_SCAN',
    worker: 'scanWorker.js'
  },
  {
    kind: 'update',
    actionEvent: 'PERFORM_UPDATE',
    worker: 'updateWorker.js'
  },
  {
    kind: 'tags',
    actionEvent: 'PERFORM_TAG_SCAN',
    worker: 'tagScanWorker.js'
  },
  {
    kind: 'subtitles',
    actionEvent: 'PERFORM_SUBTITLE_SCAN',
    worker: 'subtitleScanWorker.js'
  },
  {
    kind: 'covers',
    actionEvent: 'PERFORM_COVER_REPAIR',
    worker: 'coverScanWorker.js'
  }
]);

const SCANNER_ENTRY = Object.freeze(Object.fromEntries(
  SCAN_DEFINITIONS.map(definition => [
    definition.kind,
    path.join(__dirname, '../filesystem', definition.worker)
  ])
));

const SCAN_KINDS = Object.freeze(
  SCAN_DEFINITIONS.map(definition => definition.kind)
);

module.exports = {
  SCAN_DEFINITIONS,
  SCANNER_ENTRY,
  SCAN_KINDS
};
