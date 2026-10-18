const strftime  = require('./strftime')

const normalize = (works, options = {}) => {
  works.map(record => {
    record.nsfw = Boolean(record.nsfw);
    record.subtitle = Boolean(record.subtitle);
    record.circle = {
      id: record.circle_id,
      name: record.circle_name
    };
    record.rate_count_detail = JSON.parse(record.rate_count_detail);
    record.rank = record.rank ? JSON.parse(record.rank) : null;
    record.vas = JSON.parse(record.vaObj)['vas'];
    record.tags = JSON.parse(record.tagObj)['tags'];
    delete record.circle_name;
    delete record.vaObj;
    delete record.tagObj;
    if (options.dateOnly && record.updated_at) {
      record.updated_at = strftime('%F', record.updated_at);
    }
  })
  return works
}

module.exports = normalize;
