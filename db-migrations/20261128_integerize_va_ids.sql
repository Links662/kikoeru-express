PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

DROP VIEW IF EXISTS staticMetadata;

CREATE TEMP TABLE va_id_map (
  old_id TEXT NOT NULL PRIMARY KEY,
  new_id INTEGER NOT NULL
);

CREATE TEMP TABLE va_name_normalized (
  source_rowid INTEGER NOT NULL,
  old_id TEXT,
  normalized_name TEXT NOT NULL
);

-- Remove paired bracketed content character by character, then strip whitespace.
WITH RECURSIVE name_chars (
  source_rowid,
  old_id,
  raw_name,
  pos,
  stack,
  cleaned
) AS (
  SELECT rowid, id, name, 1, '', ''
  FROM t_va

  UNION ALL

  SELECT
    source_rowid,
    old_id,
    raw_name,
    pos + 1,
    CASE
      WHEN substr(raw_name, pos, 1) = '(' THEN stack || ')'
      WHEN substr(raw_name, pos, 1) = '（' THEN stack || '）'
      WHEN substr(raw_name, pos, 1) = '[' THEN stack || ']'
      WHEN substr(raw_name, pos, 1) = '【' THEN stack || '】'
      WHEN substr(raw_name, pos, 1) = '〔' THEN stack || '〕'
      WHEN substr(raw_name, pos, 1) = '［' THEN stack || '］'
      WHEN substr(raw_name, pos, 1) IN ('{', '｛') THEN stack || '}'
      WHEN substr(raw_name, pos, 1) = '《' THEN stack || '》'
      WHEN substr(raw_name, pos, 1) = '〈' THEN stack || '〉'
      WHEN substr(raw_name, pos, 1) = '「' THEN stack || '」'
      WHEN substr(raw_name, pos, 1) = '『' THEN stack || '』'
      WHEN length(stack) > 0
        AND substr(raw_name, pos, 1) = substr(stack, -1, 1)
        THEN substr(stack, 1, length(stack) - 1)
      ELSE stack
    END,
    CASE
      WHEN length(stack) = 0
        AND instr('([（【〔［{｛《〈「『', substr(raw_name, pos, 1)) = 0
        THEN cleaned || substr(raw_name, pos, 1)
      ELSE cleaned
    END
  FROM name_chars
  WHERE pos <= length(raw_name)
)
INSERT INTO va_name_normalized (source_rowid, old_id, normalized_name)
SELECT
  source_rowid,
  old_id,
  replace(
    replace(
      replace(
        replace(
          replace(cleaned, ' ', ''),
          char(9), ''
        ),
        char(10), ''
      ),
      char(13), ''
    ),
    char(12288), ''
  )
FROM name_chars
WHERE pos = length(raw_name) + 1;

CREATE TEMP TABLE va_name_guard (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO va_name_guard (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM va_name_normalized
    WHERE normalized_name = ''
  ) THEN 0
  ELSE 1
END;

CREATE TABLE t_va_new (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name varchar(255) NOT NULL UNIQUE
);

-- 完全相同的名称只保留一个声优；规则与旧 UUIDv5 的复用语义一致。
INSERT INTO t_va_new (name)
SELECT normalized_name
FROM va_name_normalized
WHERE old_id IS NOT NULL
GROUP BY normalized_name
ORDER BY MIN(source_rowid);

INSERT INTO va_id_map (old_id, new_id)
SELECT old_va.id, new_va.id
FROM t_va AS old_va
JOIN va_name_normalized AS normalized ON normalized.old_id = old_va.id
JOIN t_va_new AS new_va ON new_va.name = normalized.normalized_name
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
DROP TABLE va_name_normalized;
DROP TABLE va_name_guard;

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
