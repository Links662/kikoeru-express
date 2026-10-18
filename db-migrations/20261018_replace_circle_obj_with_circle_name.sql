BEGIN TRANSACTION;

DROP VIEW IF EXISTS staticMetadata;

CREATE VIEW staticMetadata AS
SELECT
  w.id,
  w.title,
  w.circle_id,
  c.name AS circle_name,
  w.nsfw,
  w.subtitle,
  w.release,
  w.dl_count,
  w.price,
  w.review_count,
  w.rate_count,
  w.rate_average_2dp,
  w.rate_count_detail,
  w.rank,
  w.insert_time,
  (
    SELECT json_object('vas', json_group_array(json_object('id', v.id, 'name', v.name)))
    FROM r_va_work rv
    JOIN t_va v ON v.id = rv.va_id
    WHERE rv.work_id = w.id
  ) AS vaObj,
  (
    SELECT json_object('tags', json_group_array(json_object('id', t.id, 'name', t.name)))
    FROM r_tag_work rt
    JOIN t_tag t ON t.id = rt.tag_id
    WHERE rt.work_id = w.id
  ) AS tagObj
FROM t_work AS w
JOIN t_circle AS c ON c.id = w.circle_id;

COMMIT;
