// eslint-disable-next-line node/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;

const { hasLrc } = require('../filesystem/utils');

describe('subtitle detection', function () {
  it('marks a work as subtitled when it contains any lrc file', function () {
    expect(hasLrc([
      { title: '01.mp3', subtitle: 'disc1', ext: '.mp3' },
      { title: '01.lrc', subtitle: 'disc1', ext: '.lrc' }
    ])).to.equal(true);
  });

  it('matches lrc extensions case-insensitively', function () {
    expect(hasLrc([
      { title: '01.mp3', subtitle: null, ext: '.mp3' },
      { title: '01.LRC', subtitle: null, ext: '.LRC' }
    ])).to.equal(true);
  });

  it('does not treat other text formats as subtitles', function () {
    expect(hasLrc([
      { title: '01.mp3', subtitle: null, ext: '.mp3' },
      { title: '01.srt', subtitle: null, ext: '.srt' },
      { title: '01.ass', subtitle: null, ext: '.ass' }
    ])).to.equal(false);
  });

  it('returns false when the track list is empty or invalid', function () {
    expect(hasLrc([])).to.equal(false);
    expect(hasLrc(null)).to.equal(false);
  });
});
