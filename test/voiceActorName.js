// eslint-disable-next-line node/no-unpublished-require
const expect = require('chai').expect;

const { normalizeVoiceActorName } = require('../utils/voiceActorName');

describe('voice actor name normalization', function () {
  it('removes whitespace and bracketed content', function () {
    expect(normalizeVoiceActorName(' 柚木 つばめ ')).to.equal('柚木つばめ');
    expect(normalizeVoiceActorName('柚木つばめ（CV）')).to.equal('柚木つばめ');
    expect(normalizeVoiceActorName('【新人】柚木つばめ [CV]')).to.equal('柚木つばめ');
    expect(normalizeVoiceActorName('MOMO KA（别名）')).to.equal('MOMOKA');
  });

  it('supports nested brackets and leaves unmatched brackets untouched', function () {
    expect(normalizeVoiceActorName('Alice（主名（别名））')).to.equal('Alice');
    expect(normalizeVoiceActorName('Alice (unclosed')).to.equal('Alice(unclosed');
    expect(normalizeVoiceActorName('Alice）')).to.equal('Alice）');
    expect(normalizeVoiceActorName('（只有说明）')).to.equal('');
  });
});
