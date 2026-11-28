// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const {
  SCAN_DEFINITIONS,
  SCANNER_ENTRY,
  SCAN_KINDS
} = require('../state/scanDefinitions');

describe('scan definitions', function () {
  it('defines every scan kind exactly once', function () {
    expect(SCAN_KINDS).to.deep.equal([
      'scan',
      'update',
      'tags',
      'subtitles',
      'covers'
    ]);
    expect(new Set(SCAN_KINDS).size).to.equal(SCAN_KINDS.length);
    expect(new Set(SCAN_DEFINITIONS.map(item => item.actionEvent)).size)
      .to.equal(SCAN_DEFINITIONS.length);
  });

  it('maps every kind to an existing worker entry', function () {
    for (const definition of SCAN_DEFINITIONS) {
      expect(definition.actionEvent).to.match(/^PERFORM_/);
      expect(SCANNER_ENTRY[definition.kind]).to.be.a('string');
      expect(fs.existsSync(SCANNER_ENTRY[definition.kind])).to.equal(true);
    }
  });
});
