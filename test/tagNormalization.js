// eslint-disable-next-line node/no-unpublished-require
const expect = require('chai').expect;

const normalize = require('../routes/utils/normalize');

const createWork = () => ({
  id: 100,
  title: 'Work',
  circle_id: 1,
  circle_name: 'Circle',
  nsfw: true,
  subtitle: false,
  rate_count_detail: '[]',
  rank: null,
  vaObj: JSON.stringify({ vas: [] }),
  tagObj: JSON.stringify({
    tags: [{
      id: 14,
      name: '情侣'
    }]
  })
});

describe('tag normalization', function () {
  it('keeps the tag name materialized in t_tag', function () {
    const [work] = normalize([createWork()]);
    expect(work.tags).to.deep.equal([{ id: 14, name: '情侣' }]);
  });
});
