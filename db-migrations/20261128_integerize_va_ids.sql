PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

DROP VIEW IF EXISTS staticMetadata;

CREATE TEMP TABLE va_id_map (
  old_id TEXT NOT NULL PRIMARY KEY,
  new_id INTEGER NOT NULL
);

CREATE TABLE t_va_new (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name varchar(255) NOT NULL UNIQUE
);

-- 完全相同的名称只保留一个声优；规则与旧 UUIDv5 的复用语义一致。
INSERT INTO t_va_new (name)
SELECT name
FROM t_va
GROUP BY name
ORDER BY MIN(rowid);

INSERT INTO va_id_map (old_id, new_id)
SELECT old_va.id, new_va.id
FROM t_va AS old_va
JOIN t_va_new AS new_va ON new_va.name = old_va.name
WHERE old_va.id IS NOT NULL;

ALTER TABLE r_va_work RENAME TO r_va_work_old;
DROP INDEX IF EXISTS idx_r_va_work_work_id;
DROP TABLE t_va;

ALTER TABLE t_va_new RENAME TO t_va;

CREATE TABLE r_va_work (
  va_id INTEGER,
  work_id INTEGER,
  PRIMARY KEY (va_id, work_id),
  FOREIGN KEY (va_id) REFERENCES t_va (id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (work_id) REFERENCES t_work (id) ON UPDATE CASCADE ON DELETE CASCADE
);

INSERT OR IGNORE INTO r_va_work (va_id, work_id)
SELECT mapping.new_id, relation.work_id
FROM r_va_work_old AS relation
JOIN va_id_map AS mapping ON mapping.old_id = relation.va_id;

CREATE INDEX idx_r_va_work_work_id ON r_va_work (work_id, va_id);

DROP TABLE r_va_work_old;

UPDATE OR IGNORE t_favourite
SET item_id = CAST((
  SELECT mapping.new_id
  FROM va_id_map AS mapping
  WHERE mapping.old_id = t_favourite.item_id
) AS TEXT)
WHERE field = 'va'
  AND EXISTS (
    SELECT 1
    FROM va_id_map AS mapping
    WHERE mapping.old_id = t_favourite.item_id
  );

-- 移除无法映射的旧收藏，并合并同名 UUID 导致的重复收藏。
DELETE FROM t_favourite
WHERE field = 'va'
  AND NOT EXISTS (
    SELECT 1
    FROM t_va
    WHERE CAST(t_va.id AS TEXT) = t_favourite.item_id
  );

DELETE FROM t_favourite
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM t_favourite
  GROUP BY user_name, field, item_id
);

DROP TABLE va_id_map;

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

PRAGMA foreign_keys = ON;
